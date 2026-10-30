// S3 兼容图床客户端（代理外观，P1-001 重写）：
// 旧实现 aws4fetch 浏览器直连 + localStorage 明文凭据已删除——凭据现仅存
// Worker 侧加密存储（cloudflare-worker/src/services/mediaS3Config.service），
// 上传/列举/删除经 /api/media/s3/* 代理执行，secret 永不回传浏览器。
//
// 本模块保留原有导出名与调用形态（s3ListObjects/s3PutObject/s3DeleteObject/
// s3PublicUrl/contentTypeForKey），页面层（MediaPage/useMediaLibrary）无需理解
// 代理协议；cfg 参数仅使用 publicBaseUrl（外链拼接）与 backendId（目标桶），
// 不再读取任何凭据字段。
import {
  listMediaS3Objects, putMediaS3Object, deleteMediaS3Object,
} from './mediaS3Api.ts';
import type { S3MediaConfig } from '../../../shared/types';

/** 单个对象条目（媒体库列表用） */
export interface S3MediaEntry {
  key: string;
  size: number;
  lastModified: number;
}

/** 兼容旧调用点的视图类型：代理模式下只有外链基址与目标 backend id 有意义 */
export interface S3MediaSourceView extends Pick<S3MediaConfig, 'publicBaseUrl'> {
  /** 目标后端 id（并行多桶）；缺省 = 'default' */
  backendId?: string;
}

/** 无法从扩展名判定时的兜底 MIME */
const OCTET_STREAM = 'application/octet-stream';

/**
 * 按扩展名推断 Content-Type。
 * 覆盖范围需与 mediaUtils 的 EXT_BY_FORMAT 保持一致：那边决定落盘扩展名，
 * 这边决定同一扩展名的 MIME；新增格式时两处同改（mediaUploadPlan.test.ts 有交叉校验）。
 */
export function contentTypeForKey(key: string): string {
  const ext = (key.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
    heic: 'image/heic', heif: 'image/heif',
    mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm',
    ogv: 'video/ogg', ogg: 'video/ogg', mov: 'video/quicktime',
  };
  return map[ext] ?? OCTET_STREAM;
}

/** 上传（经 Worker 代理）。Content-Type 语义沿用旧直连实现：落盘扩展名优先。 */
export async function s3PutObject(cfg: S3MediaSourceView, key: string, blob: Blob): Promise<void> {
  // 优先级：**落盘扩展名优先于 blob.type**。原因：上传管线用魔数嗅探纠正扩展名
  // （见 mediaUploadPlan 的 plan.ext），但 File.type 仍是浏览器按**原**扩展名给的 MIME。
  // 用户把 webm 改名成 .mp4 上传时，key 是 .webm 而 blob.type 是 video/mp4，
  // 若优先取 blob.type 会写入与内容不符的 MIME，浏览器解码直接失败。
  const byExt = contentTypeForKey(key);
  const contentType = byExt === OCTET_STREAM ? (blob.type || OCTET_STREAM) : byExt;
  await putMediaS3Object(key, blob, contentType, cfg.backendId);
}

export async function s3DeleteObject(cfg: S3MediaSourceView, key: string): Promise<void> {
  await deleteMediaS3Object(key, cfg.backendId);
}

/** 列举前缀下全部对象（经 Worker 代理；分页由服务端聚合） */
export async function s3ListObjects(cfg: S3MediaSourceView, prefix: string): Promise<S3MediaEntry[]> {
  const entries = await listMediaS3Objects(prefix, cfg.backendId);
  return entries.map((e) => ({
    key: e.key,
    size: e.size,
    lastModified: e.lastModified ? new Date(e.lastModified).getTime() || 0 : 0,
  }));
}

/**
 * 由公网基址构造外链 URL；未配置 publicBaseUrl 时返回空串（UI 层降级）。
 *
 * 多桶私读支持：publicBaseUrl 指向本 Worker 的 /media-file/ 代理时，
 * 显式携带 backendId query 参数定位目标桶（缺省 = default）。非代理基址
 * （直连桶 CDN 域名）不受影响——backendId 会被桶侧当作无害的多余参数忽略。
 * 隐式拼接由 URL 对象完成，保证 backendId 正确百分号编码。
 */
export function s3PublicUrl(cfg: S3MediaSourceView, key: string): string {
  if (!cfg.publicBaseUrl) return '';
  const base = cfg.publicBaseUrl
    .replace('{bucket}', '')
    .replace('{key}', key.split('/').map(encodeURIComponent).join('/'))
    .replace('{path}', key);
  if (!cfg.backendId || cfg.backendId === 'default') return base;
  try {
    // 仅在 http(s) URL 上追加 backendId：非法基址按原样返回（由调用方降级处理）
    const url = new URL(base);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.searchParams.set('backendId', cfg.backendId);
      return url.toString();
    }
  } catch {
    // new URL 解析失败：base 不是绝对地址，按原样返回
  }
  return base;
}
