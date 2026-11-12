// 前端配置 Schema 校验（P3-5）：MediaConfig / 集合配置的运行时守门。
//
// 背景：CollectionsContext 加载层此前只做「字段白名单过滤」（MEDIA_CONFIG_KEYS），
// 值类型漂移（如 quality 存成字符串）会静默进入业务层。Zod 校验在读取时归一/拒绝，
// 对齐 worker 侧 storedConfigSchema 的既有范式。
//
// 并行媒体仓库（P1）：新增 MediaBackend 校验 + 旧配置迁移。旧 sourceType + 扁平字段
// （imageOwner/imageRepo/imageBranch/mediaPath/imageBranchName）迁移为单个 backend，
// 写入 backends 数组并设 defaultBackendId。
//
// 【双真相收敛（2026-11-12）】迁移上线后旧字段只剩「legacy 读取分支」一处消费，
// 运行时权威是 backends + defaultBackendId。本模块现在区分两个出口：
//   · parseStoredMediaConfig —— 读取用，容忍旧字段（负责迁移）
//   · pruneLegacyMediaFields —— 写回用，剥掉 6 个迁移源字段（含已零引用的 imageBranchName）
// 两者由 CollectionsContext 的 load → save 链路串联，保证 localStorage 在第一次
// 读取后即收敛为单一真相。
import { z } from 'zod';
import type { MediaBackend, MediaConfig, MediaSourceType } from '../../../shared/types';

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

/**
 * S3 外链配置：运行时只认 publicBaseUrl（凭据 P1-001 起存 Worker 侧 D1）。
 *
 * 【历史兼容】旧版本曾在 localStorage 存过完整凭据对象
 * （endpoint/region/bucket/accessKeyId/secretAccessKey/prefix/publicBaseUrl）。
 * 这里用 passthrough 允许多余键通过、只强制 publicBaseUrl 的**类型**，
 * 避免旧数据整份校验失败回退默认值（那会让用户已配好的外链基址静默丢失）。
 * 真正丢弃凭据的是 pruneLegacyMediaFields。
 */
const s3MediaConfigSchema = z
  .object({ publicBaseUrl: z.string() })
  .passthrough();

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
  s3: s3MediaConfigSchema.optional(),
  backends: z.array(mediaBackendSchema),
  defaultBackendId: z.string(),
});

/** 默认 backend id 常量：迁移/缺省时共用，保证 id 稳定可被 Worker S3 分键引用 */
export const DEFAULT_BACKEND_ID = 'default';

/** 迁移源字段（legacy 专用）。写回时必须剥掉，运行时不得再读。 */
export const LEGACY_MEDIA_FIELDS = [
  'sourceType',
  'imageOwner',
  'imageRepo',
  'imageBranch',
  'mediaPath',
  'imageBranchName',
] as const;

type LegacyMediaField = (typeof LEGACY_MEDIA_FIELDS)[number];

/**
 * 从旧 sourceType + 扁平字段构造单个 backend（迁移用）。
 * 纯函数：供 parseStoredMediaConfig 在 backends 缺失时兜底。
 *
 * `imageBranchName` 已从 MediaConfig 移除（并行仓库后由 backend.branch 承担），
 * 这里仍作为入参保留：它只在「读旧 localStorage / 旧 .bloath/config.json」时出现。
 */
export function backendFromLegacy(cfg: {
  sourceType: MediaSourceType;
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
    default:
      // 类型上不可达，但运行时 raw 数据可能带任意字符串；返回 standalone 兜底，
      // 保证「结构非法也不产生 undefined backend」
      return {
        id: DEFAULT_BACKEND_ID,
        kind: 'standalone',
        label: '独立图床仓库',
        enabled: true,
        owner: cfg.imageOwner,
        repo: cfg.imageRepo,
        branch: cfg.imageBranch || 'main',
      };
  }
}

/**
 * 安全解析 MediaConfig：成功返回归一化对象；失败返回 null（调用方回退默认值）。
 * 与 worker 侧 bufferConfig.service 的 parseStoredConfig 同语义。
 *
 * 迁移语义：旧配置无 backends 字段时，由 sourceType + 扁平字段构造单个 backend
 * 并写入 backends / defaultBackendId，保证升级后媒体源仍可用。
 *
 * 【断言】迁移成功后 backends 必然非空。若仍为空说明源数据的 sourceType 也缺失，
 * 此时返回 null 交给调用方回退默认值——不允许「backends 为空但解析成功」的状态
 * 流到运行时，那会让 resolveMediaBackend 无 backend 可用。
 */
export function parseStoredMediaConfig(raw: unknown): MediaConfig | null {
  const base = mediaConfigSchema.safeParse(raw);
  if (base.success) {
    // 结构合法但 backends 为空：补一个默认 backend，使下游不必处理空列表
    if (base.data.backends.length === 0) {
      return { ...base.data, backends: [defaultBackendFor(base.data.sourceType)], defaultBackendId: DEFAULT_BACKEND_ID };
    }
    return base.data;
  }

  // 校验失败兜底：可能是「缺 backends/defaultBackendId 的旧结构」。
  // 先补上迁移字段再重试，仍失败才返回 null。
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    const hasBackends = Array.isArray(rec.backends) && rec.backends.length > 0;
    if (!hasBackends && typeof rec.sourceType === 'string') {
      try {
        const migrated = {
          ...rec,
          backends: [backendFromLegacy({
            sourceType: rec.sourceType as MediaSourceType,
            imageOwner: String(rec.imageOwner ?? ''),
            imageRepo: String(rec.imageRepo ?? ''),
            imageBranch: String(rec.imageBranch ?? 'main'),
            mediaPath: String(rec.mediaPath ?? 'assets'),
            imageBranchName: String(rec.imageBranchName ?? 'assets'),
            s3: rec.s3 as MediaConfig['s3'],
          })],
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

/**
 * 剥掉 6 个迁移源字段，返回只含运行时权威字段的 MediaConfig。
 *
 * 【为什么需要】读取侧为兼容旧数据必须容忍这些字段，但**写回侧不能继续保留**：
 * 留着就会形成「一个概念两份真相」，任何一处漏改都可能让旧字段与新字段打架
 * （2026-11-12 架构审查 P1：数据模型双真相）。本函数由 CollectionsContext 的
 * save 链路调用，保证 localStorage 在第一次加载后立即收敛。
 *
 * 纯函数，不修改入参；返回对象的 s3 也只剩 publicBaseUrl。
 */
export function pruneLegacyMediaFields(config: MediaConfig): MediaConfig {
  const pruned = { ...config } as MediaConfig & Partial<Record<LegacyMediaField, unknown>>;
  for (const field of LEGACY_MEDIA_FIELDS) {
    delete pruned[field];
  }
  if (config.s3) {
    // 旧数据可能带完整凭据对象；这里只保留外链基址（凭据应在 Worker 侧 D1）
    pruned.s3 = { publicBaseUrl: config.s3.publicBaseUrl };
  }
  return pruned as MediaConfig;
}

/** 按 sourceType 造一个最小可用 backend（backends 为空时的兜底） */
function defaultBackendFor(sourceType: MediaSourceType): MediaBackend {
  return backendFromLegacy({
    sourceType,
    imageOwner: '',
    imageRepo: '',
    imageBranch: 'main',
    mediaPath: 'assets',
    imageBranchName: 'assets',
  });
}
