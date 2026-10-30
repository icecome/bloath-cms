// 前端配置 Schema 校验（P3-5）：MediaConfig / 集合配置的运行时守门。
//
// 背景：CollectionsContext 加载层此前只做「字段白名单过滤」（MEDIA_CONFIG_KEYS），
// 值类型漂移（如 quality 存成字符串）会静默进入业务层。Zod 校验在读取时归一/拒绝，
// 对齐 worker 侧 storedConfigSchema 的既有范式。
//
// 并行媒体仓库（P1）：新增 MediaBackend 校验 + 旧配置迁移。旧 sourceType + 扁平字段
// （imageOwner/imageRepo/imageBranch/mediaPath/imageBranchName/s3）迁移为单个 backend，
// 写入 backends 数组并设 defaultBackendId。旧字段保留为「迁移源」，运行时以 backends 为准。
import { z } from 'zod';
import type { MediaBackend, MediaConfig } from '../../../shared/types';

const mediaBackendSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['standalone', 'repo-dir', 'image-branch', 's3']),
  label: z.string(),
  enabled: z.boolean(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  pathPrefix: z.string().optional(),
  s3PublicBaseUrl: z.string().optional(),
});

/** MediaConfig 运行时 schema：与 shared/types.ts 的类型定义一一对应 */
export const mediaConfigSchema = z.object({
  sourceType: z.enum(['standalone', 'repo-dir', 'image-branch', 's3']),
  imageOwner: z.string(),
  imageRepo: z.string(),
  imageBranch: z.string(),
  mediaPath: z.string(),
  imageBranchName: z.string(),
  cdnProvider: z.enum(['jsdelivr', 'github_raw', 'custom']),
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
  backends: z.array(mediaBackendSchema),
  defaultBackendId: z.string(),
});

/** 默认 backend id 常量：迁移/缺省时共用，保证 id 稳定可被 Worker S3 分键引用 */
export const DEFAULT_BACKEND_ID = 'default';

/**
 * 从旧 sourceType + 扁平字段构造单个 backend（迁移用）。
 * 纯函数：供 parseStoredMediaConfig 在 backends 缺失时兜底。
 */
export function backendFromLegacy(cfg: {
  sourceType: MediaConfig['sourceType'];
  imageOwner: string;
  imageRepo: string;
  imageBranch: string;
  mediaPath: string;
  imageBranchName: string;
  s3?: MediaConfig['s3'];
}): MediaBackend {
  const kind = cfg.sourceType;
  switch (kind) {
    case 'standalone':
      return {
        id: DEFAULT_BACKEND_ID,
        kind,
        label: '独立图床仓库',
        enabled: true,
        owner: cfg.imageOwner,
        repo: cfg.imageRepo,
        branch: cfg.imageBranch || 'main',
      };
    case 'repo-dir':
      return {
        id: DEFAULT_BACKEND_ID,
        kind,
        label: '博客仓库子目录',
        enabled: true,
        pathPrefix: cfg.mediaPath,
      };
    case 'image-branch':
      return {
        id: DEFAULT_BACKEND_ID,
        kind,
        label: '博客仓库独立分支',
        enabled: true,
        branch: cfg.imageBranchName,
      };
    case 's3':
      return {
        id: DEFAULT_BACKEND_ID,
        kind,
        label: 'S3 兼容图床',
        enabled: true,
        s3PublicBaseUrl: cfg.s3?.publicBaseUrl ?? '',
      };
  }
}

/**
 * 安全解析 MediaConfig：成功返回归一化对象；失败返回 null（调用方回退默认值）。
 * 与 worker 侧 bufferConfig.service 的 parseStoredConfig 同语义。
 *
 * 迁移语义：旧配置无 backends 字段时，由 sourceType + 扁平字段构造单个 backend
 * 并写入 backends / defaultBackendId，保证升级后媒体源仍可用。
 */
export function parseStoredMediaConfig(raw: unknown): MediaConfig | null {
  const base = mediaConfigSchema.safeParse(raw);
  if (base.success) return base.data;

  // 校验失败兜底：可能是「缺 backends/defaultBackendId 的旧结构」。
  // 先补上迁移字段再重试，仍失败才返回 null。
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    const hasBackends = Array.isArray(rec.backends) && rec.backends.length > 0;
    if (!hasBackends && typeof rec.sourceType === 'string') {
      try {
        const legacy = {
          sourceType: rec.sourceType as MediaConfig['sourceType'],
          imageOwner: String(rec.imageOwner ?? ''),
          imageRepo: String(rec.imageRepo ?? ''),
          imageBranch: String(rec.imageBranch ?? 'main'),
          mediaPath: String(rec.mediaPath ?? 'assets'),
          imageBranchName: String(rec.imageBranchName ?? 'assets'),
          s3: rec.s3 as MediaConfig['s3'],
        };
        const migrated = {
          ...rec,
          backends: [backendFromLegacy(legacy)],
          defaultBackendId: String(rec.defaultBackendId ?? DEFAULT_BACKEND_ID),
        };
        const reparsed = mediaConfigSchema.safeParse(migrated);
        if (reparsed.success) return reparsed.data;
      } catch {
        // 迁移失败落到最终 null
      }
    }
  }
  return null;
}
