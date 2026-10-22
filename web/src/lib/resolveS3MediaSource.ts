// S3 媒体源的源解析分支（P3-2）：与 GitHub 三形态并列的第四种图床形态。
//
// 设计：ResolvedMediaSource 的 GitHub 字段对 S3 源无意义，因此本函数返回
// S3 专属视图（S3ResolvedMediaSource），调用方（MediaPage）按 sourceType 分流——
// GitHub 源走 getTree/uploadImage API，S3 源走 s3MediaClient。
import type { MediaConfig } from '../../../shared/types';

/** S3 源解析结果 */
export interface S3ResolvedSource {
  configured: boolean;
  missingHint?: string;
}

/**
 * 校验 S3 媒体源配置完整性。不触网，仅检查必填字段。
 */
export function resolveS3MediaSource(config: MediaConfig): S3ResolvedSource {
  const s3 = config.s3;
  if (!s3) {
    return { configured: false, missingHint: '请在设置页填写 S3 图床的端点与密钥' };
  }
  if (!s3.endpoint || !s3.bucket || !s3.accessKeyId || !s3.secretAccessKey) {
    return { configured: false, missingHint: 'S3 图床配置不完整：端点、桶名、AccessKey、SecretKey 均必填' };
  }
  return { configured: true };
}

/**
 * S3 源的键前缀归一：去首尾斜杠；空串表示桶根。
 */
export function s3MediaPrefix(config: MediaConfig): string {
  return (config.s3?.prefix || '').replace(/^\/+|\/+$/g, '');
}
