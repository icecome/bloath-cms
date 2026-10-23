// 前端配置 Schema 校验（P3-5）：MediaConfig / 集合配置的运行时守门。
//
// 背景：CollectionsContext 加载层此前只做「字段白名单过滤」（MEDIA_CONFIG_KEYS），
// 值类型漂移（如 quality 存成字符串）会静默进入业务层。Zod 校验在读取时归一/拒绝，
// 对齐 worker 侧 storedConfigSchema 的既有范式。
import { z } from 'zod';
import type { MediaConfig } from '../../../shared/types';

/** MediaConfig 运行时 schema：与 shared/types.ts 的类型定义一一对应 */
export const mediaConfigSchema = z.object({
  sourceType: z.enum(['standalone', 'repo-dir', 'image-branch', 's3']),
  imageOwner: z.string(),
  imageRepo: z.string(),
  imageBranch: z.string(),
  mediaPath: z.string(),
  imageBranchName: z.string(),
  cdnProvider: z.enum(['jsdmirror', 'github_raw', 'custom']),
  customCdnTemplate: z.string(),
  quality: z.number().int().min(10).max(100),
  renameTemplate: z.string(),
  duplicateStrategy: z.enum(['skip', 'overwrite']),
  // 存量 localStorage 无此字段：loadMediaConfig 先与默认值合并再校验，
  // 缺失时补成 'compress'，不会因校验失败而整份回退
  uploadMode: z.enum(['compress', 'original']),
  s3: z
    .object({
      endpoint: z.string(),
      region: z.string(),
      bucket: z.string(),
      accessKeyId: z.string(),
      secretAccessKey: z.string(),
      prefix: z.string(),
      publicBaseUrl: z.string(),
    })
    .optional(),
});

/**
 * 安全解析 MediaConfig：成功返回归一化对象；失败返回 null（调用方回退默认值）。
 * 与 worker 侧 bufferConfig.service 的 parseStoredConfig 同语义。
 */
export function parseStoredMediaConfig(raw: unknown): MediaConfig | null {
  const result = mediaConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}
