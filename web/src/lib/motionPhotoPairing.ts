// 动态照片列表聚合层（纯函数，可进 node --test）。
//
// 【存在原因】单文件合成方案下，动态照片在仓库里可能处于三种文件组合：
//   · 已完成：motion/1.jpg（成品）
//   · 转码中：motion/1.src.jpg + motion/1.src.mp4 + motion/1.motion.json
//   · 降级成对：motion/1.jpg + motion/1.mp4（S3 wasm 转码失败，XMP 失效）
// 后两种若直接进列表，会出现「同一张照片多个条目」「中间态源文件暴露」的问题。
// 本模块在**列表出口一次性**把它们折叠/过滤为正确的展示条目——
// 与「排序只在 scanner 出口做一次」的既有惯例同构（AGENTS.md R10）。
//
// 【设计取舍】转码中不隐藏条目，而是合成一个「虚拟条目」指向 src.jpg 作静态预览，
// 让用户知道「这张照片在处理中」而不是「我的照片不见了」——隐藏会导致用户重复上传。

import { motionBaseNameOf, isMotionManifestName, isMotionStillSourceName } from './motionPhotoManifest.ts';
import { isServerTranscodeSource } from './motionPhotoServerTranscode.ts';

/** 聚合需要的文件最小信息（与 MediaFile 结构兼容，避免反向依赖 UI 层类型） */
export interface MotionPairFile {
  name: string;
  path: string;
  sha: string;
  size?: number;
  url: string;
  lastModified: number;
}

/** 中间态文件的分类结果 */
export type MotionFileRole = 'still-source' | 'video-source' | 'manifest' | 'plain';

/**
 * 判定文件在动态照片家族中的角色。
 * 注意：`.src.mp4` 既可能是动态照片的视频源，也可能是普通场景误用——
 * 这里只做角色判定，是否折叠由调用方结合同目录其他文件决定。
 */
export function motionFileRole(name: string): MotionFileRole {
  if (isMotionManifestName(name)) return 'manifest';
  if (isMotionStillSourceName(name)) return 'still-source';
  if (isServerTranscodeSource(name)) return 'video-source';
  return 'plain';
}

/** 拆出目录与文件基础名（不含扩展名） */
export function splitDirAndStem(path: string): { dir: string; stem: string } {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash) : '';
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  // 只剥一层扩展名；.src.jpg 这类由 motionBaseNameOf 单独处理
  const dot = file.lastIndexOf('.');
  return { dir, stem: dot > 0 ? file.slice(0, dot) : file };
}

/**
 * 过滤中间态与派生产物，仅保留应展示的文件。
 *
 * @param files 仓库内全部文件（含 thumb-*、*.src.*、*.motion.json）
 * @param isDerived 判定派生产物（缩略图/封面）的谓词，由调用方注入
 *                 （mediaUtils.isDerivedAsset；此处不直接 import 以免循环依赖）
 * @param toDisplay 把原始文件转为展示条目（补 kind 等字段）
 */
export function filterMotionIntermediates<T extends MotionPairFile>(
  files: T[],
  isDerived: (name: string) => boolean,
  toDisplay: (file: T) => T
): T[] {
  // 先收集「哪些 baseName 已有成品 <base>.jpg」，用于判定视频源是否降级成对场景
  const out: T[] = [];
  for (const f of files) {
    if (isDerived(f.name)) continue;
    const role = motionFileRole(f.name);
    if (role === 'manifest') continue;
    if (role === 'still-source') continue; // 转码中：由 buildTranscodingEntries 单独合成条目
    if (role === 'video-source') continue; // .src.mp4 永不独立展示（既有行为）
    out.push(toDisplay(f));
  }
  return out;
}

/** 转码疑似失败的阈值（ms）：远大于 cron 30 分钟兜底周期 + 排队余量，避免误报 */
export const STALE_TRANSCODE_MS = 2 * 60 * 60 * 1000;

/**
 * 为「转码中」的动态照片合成虚拟展示条目。
 *
 * 条目的 path/url 指向真实的 `.src.jpg`（静态预览可用、缩略图查找不错位、
 * 删除操作命中真实文件），并附加三个标记字段供 UI 使用：
 *   · transcoding = true → 显示「转码中」徽标
 *   · outputPath          → 成品落盘路径（插博客时用这个，仓库里尚不存在）
 *   · stale               → true 时 pendingSince 已超 STALE_TRANSCODE_MS，
 *                           UI 应显示「合成疑似失败」+ 提供放弃/重试入口（m-04）
 *
 * @param files 仓库内全部文件（含中间态）
 * @param isDerived 派生产物谓词（跳过缩略图等）
 * @param urlFor 路径 → URL（各后端拼装方式不同，由调用方注入）
 * @param now 当前时间戳（ms）；可注入便于测试
 */
export function buildTranscodingEntries<T extends MotionPairFile>(
  files: T[],
  isDerived: (name: string) => boolean,
  urlFor: (path: string) => string,
  now: number = Date.now()
): Array<T & { transcoding: true; outputPath: string; stale: boolean }> {
  // 收集已成品的路径集合（同目录 + 同 stem 的 .jpg）
  const doneStems = new Set<string>();
  for (const f of files) {
    if (isDerived(f.name)) continue;
    if (motionFileRole(f.name) === 'plain' && /\.jpe?g$/i.test(f.name)) {
      const { dir, stem } = splitDirAndStem(f.path);
      doneStems.add(`${dir}/${stem}`);
    }
  }

  const seen = new Set<string>();
  const entries: Array<T & { transcoding: true; outputPath: string; stale: boolean }> = [];
  for (const f of files) {
    if (isDerived(f.name)) continue;
    if (motionFileRole(f.name) !== 'still-source') continue;

    const base = motionBaseNameOf(f.name);
    if (!base) continue;
    const dir = f.path.slice(0, f.path.lastIndexOf('/') + 1);
    const key = `${dir}${base}`;
    if (doneStems.has(key)) continue; // 成品已就绪：src.jpg 属残留，不建条目
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      ...f,
      // 静态预览与操作都落在真实的源图上
      size: f.size,
      url: urlFor(f.path),
      transcoding: true,
      // 成品落盘路径（仓库中尚不存在，转码完成后才会出现）
      outputPath: `${dir}${base}.jpg`,
      // 超时判定：src.jpg 的 lastModified = 上传时刻，超过阈值视为合成疑似失败
      stale: now - f.lastModified > STALE_TRANSCODE_MS,
    });
  }
  return entries;
}
