// 上传计划层：把「格式判定 → 类型 → 模式 → 扩展名 → 上限」收成一个纯函数。
//
// 为什么要把决策与执行分开：改造前的 handleUpload 把三件事硬编码在一个循环里——
//   · 恒压缩（compressImage 是唯一路径）
//   · 扩展名硬编码 '.webp'
//   · 只接受 image/*（视频在 filter 阶段被无声丢弃）
// 视频接入后需要「不压缩、不 base64、扩展名随容器变」，三条都与原假设冲突。
// 集中到本模块后，执行层只按计划执行，不再做策略判断。
//
// 本模块是纯函数（不碰 DOM、不发请求），可直接单测。
import type { UploadMode } from '../../../shared/types';
import { sniffMedia } from './formatSniff.ts';
import { extForFormat } from './mediaUtils.ts';
import {
  IMAGE_MAX_SOURCE_BYTES,
  IMAGE_ORIGINAL_MAX_BYTES,
  videoMaxBytes,
  formatMegabytes,
} from './mediaLimits.ts';

export type MediaKind = 'image' | 'video';

export interface UploadPlan {
  file: File;
  kind: MediaKind;
  /** 实际生效的模式（可能因格式或体积与用户选择不同） */
  mode: UploadMode;
  /** 落盘扩展名（不含点） */
  ext: string;
  /** 嗅探出的格式标识 */
  format: string;
  /** 模式被改写时的用户可读原因；null = 用户选择直接生效 */
  modeReason: string | null;
}

/** 计划阶段的拒绝：消息面向用户，可直接展示 */
export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejected';
  }
}

/** 不支持在浏览器 <video> 中播放的容器：给出可执行的替代建议，而不是干瘪的「格式错误」 */
const UNSUPPORTED_VIDEO: Record<string, string> = {
  matroska: 'MKV',
  avi: 'AVI',
};

/**
 * 上传前的唯一决策点。所有拒绝在此发生。
 *
 * @param requested 用户在界面上选择的模式
 * @param isS3 当前媒体源是否为 S3（决定视频上限）
 */
export async function planUpload(
  file: File,
  requested: UploadMode,
  opts: { isS3: boolean }
): Promise<UploadPlan> {
  const { kind, format } = await sniffMedia(file);

  if (format.startsWith('dangerous:')) {
    throw new UploadRejected(
      `「${file.name}」实际内容是 ${format.slice('dangerous:'.length)}，与媒体格式不符，已拒绝上传`
    );
  }
  if (kind === 'unknown') {
    throw new UploadRejected(`「${file.name}」无法识别为图片或视频，已拒绝上传`);
  }

  if (kind === 'video') {
    const unsupported = UNSUPPORTED_VIDEO[format];
    if (unsupported) {
      throw new UploadRejected(
        `「${file.name}」是 ${unsupported} 容器，浏览器无法直接播放，请先转为 MP4 或 WebM`
      );
    }

    const limit = videoMaxBytes(opts.isS3);
    if (file.size > limit) {
      throw new UploadRejected(
        `「${file.name}」（${formatMegabytes(file.size)}）超过视频上限 ${formatMegabytes(limit)}`
        + (opts.isS3 ? '' : '，大视频建议改用 S3 图床')
      );
    }

    // 视频恒为原样上传：浏览器端没有可靠的转码能力（见设计方案 §3.1）
    return {
      file,
      kind,
      mode: 'original',
      ext: extForFormat(format),
      format,
      modeReason: '视频不压缩，按原样上传',
    };
  }

  // ---- 图片 ----
  // GIF 压缩会丢动画（Canvas 只取首帧），SVG 光栅化是画质与体积双输：两者强制原图
  const forcedReason =
    format === 'gif' ? 'GIF 压缩会丢失动画，已按原图上传'
    : format === 'svg' ? 'SVG 为矢量格式，压缩会损失画质，已按原图上传'
    : null;

  let mode: UploadMode = forcedReason ? 'original' : requested;
  let modeReason = forcedReason;

  const limit = mode === 'original' ? IMAGE_ORIGINAL_MAX_BYTES : IMAGE_MAX_SOURCE_BYTES;
  if (file.size > limit) {
    // 原图超限但压缩能过：自动降级而不是直接拒绝（用户目标是把图传上去）
    if (mode === 'original' && file.size <= IMAGE_MAX_SOURCE_BYTES) {
      mode = 'compress';
      modeReason = `原图超过 ${formatMegabytes(IMAGE_ORIGINAL_MAX_BYTES)}，已自动压缩`;
    } else {
      throw new UploadRejected(
        `「${file.name}」（${formatMegabytes(file.size)}）超过上限 ${formatMegabytes(limit)}`
      );
    }
  }

  return {
    file,
    kind,
    mode,
    ext: mode === 'compress' ? 'webp' : extForFormat(format),
    format,
    modeReason,
  };
}

/** 图片计划里哪些需要真正做重编码（原图模式直接读原始字节） */
export function shouldCompress(plan: UploadPlan): boolean {
  return plan.kind === 'image' && plan.mode === 'compress';
}
