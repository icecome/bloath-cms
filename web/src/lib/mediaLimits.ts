// 媒体体积上限（单一来源）。
//
// 为什么集中：此前三个位置各写各的，互相矛盾——
//   web/src/lib/mediaUtils.ts  MAX_FILE_SIZE = 20 MB（源文件）
//   worker pathGuard.ts        MAX_CONTENT_SIZE = 10 MB（**base64 字符串**长度，实际只允许 ~7.5 MB 二进制）
//   worker pathGuard.ts        safeJsonParse 上限 20 MB（JSON 文本）
// 症状是「前端放行、服务端 400」，且提示文案与实际允许的体积不符。
//
// 注意：worker 侧无法 import 本模块（运行环境隔离），对应常量在
// cloudflare-worker/src/middleware/pathGuard.ts，两侧调整需同步（同 lib/concurrency.ts 的约定）。

/** 压缩模式：源文件上限（压缩后必然更小） */
export const IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** 原图模式：源文件上限。base64 后约 ×4/3，须小于 worker 的 MAX_CONTENT_SIZE */
export const IMAGE_ORIGINAL_MAX_BYTES = 14 * 1024 * 1024;

/** 视频上限：GitHub 仓库通道（走 base64 端点，受 worker 内存与 API 限制） */
export const VIDEO_MAX_BYTES_GITHUB = 25 * 1024 * 1024;

/** 视频上限：S3 直传通道（浏览器 → 对象存储，不经 Worker） */
export const VIDEO_MAX_BYTES_S3 = 200 * 1024 * 1024;

/** 按存储后端解析视频上限 */
export function videoMaxBytes(isS3: boolean): number {
  return isS3 ? VIDEO_MAX_BYTES_S3 : VIDEO_MAX_BYTES_GITHUB;
}

/** base64 编码后的长度（前端提前拦截用，避免传完才 400） */
export function estimateBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** 字节数 → 人类可读（错误文案用，避免各处重复 toFixed） */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
