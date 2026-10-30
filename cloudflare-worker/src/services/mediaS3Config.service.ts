// 媒体库 S3 配置存取（D1 app_settings）+ 密钥 AES-GCM 加密。
//
// 迁移背景（P1-001）：此前媒体库 S3 的 AccessKey/Secret 明文存浏览器 localStorage
// 并以 aws4fetch 浏览器直连签名——任何 XSS 即可整桶端走；且推送配置到仓库时
// 凭据可能被写进公开文件（repoConfigSync 已双侧剥离，但存储面本身就该收掉）。
// 迁移后凭据仅存 Worker 侧（加密），上传/列表/删除经 /api/media/s3/* 代理执行，
// secret 永不回传浏览器。
//
// 多桶分键（并行媒体仓库）：同一 app_settings 表按 backend id 分键存储，
// 键名 `media_s3_config:<id>`。前端传来的 backendId 经白名单校验（字母数字与
// 连字符/下划线，≤64 字符），防止任意键注入共享表。单桶历史键 `media_s3_config`
// 在读取缺省 id 时自动迁移（读侧一次性拷贝到 `media_s3_config:<DEFAULT_ID>`，
// 原键保留不删——迁移不可逆约定下不做破坏性清理，重复读取幂等）。
//
// 与 bufferConfig.service 同构：sealWithSecret/openWithSecret + 领域标签分离 +
// 读侧 zod 结构校验（共享表防御脏数据，AGENTS.md 约定）。
import { z } from 'zod';
import type { Env } from '../env';
import { openWithSecret, sealWithSecret } from './crypto.service';
import { getSettingRaw, saveSettingRaw } from './settings.service';
import { DEFAULT_BACKEND_ID, normalizeBackendId } from './mediaBackendId';
import { storageKey, getStoredS3Config } from './s3ConfigStore';

// re-export：路由层从本服务统一 import（保持单一入口）
export { DEFAULT_BACKEND_ID, normalizeBackendId } from './mediaBackendId';

export interface MediaS3Config {
  endpoint: string;   // https://s3.xxx.com（路径风格）
  region: string;     // R2 固定 auto
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string; // 明文仅在内存；存储为密文
  prefix: string;          // 目录前缀（可空 = 桶根）
}

export interface MediaS3ConfigPublic {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyIdMasked: string; // 仅尾 4 位：AK 也打码（审计 P2-32 同语义）
  prefix: string;
  configured: boolean;
}

/** 缺省 backend id：与前端 configSchema 的 DEFAULT_BACKEND_ID 保持一致（定义见 mediaBackendId.ts） */

const CRYPTO_DOMAIN = 'media-s3-config:';

/** D1 存储端口适配器：注入 s3ConfigStore 的纯函数（迁移逻辑与存储解耦，便于单测） */
function d1Store(env: Env) {
  return {
    get: (key: string) => getSettingRaw(env.DB, key),
    set: (key: string, value: string) => saveSettingRaw(env.DB, key, value),
  };
}

function maskSecret(s: string): string {
  if (!s) return '';
  return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
}

const storedSchema = z.object({
  endpoint: z.string().min(1),
  region: z.string().optional(),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKeyEnc: z.string().min(1),
  prefix: z.string().optional(),
});

function parseStored(raw: string): (z.infer<typeof storedSchema>) | null {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error('[mediaS3Config] 存储结构非法：', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return null;
    }
    return parsed.data;
  } catch (err) {
    console.error('[mediaS3Config] JSON 解析失败：', err);
    return null;
  }
}

/**
 * 读取指定 backend 的存储值（含历史单桶迁移）；委托给 s3ConfigStore 的纯函数。
 * 迁移是幂等的：原键保留，分键存在后不再读历史键。
 */
async function getStoredValue(env: Env, backendId: string): Promise<string | null> {
  return getStoredS3Config(d1Store(env), backendId);
}

/** 读取完整配置（含解密后的 secret）；未配置/解密失败返回 null */
export async function getMediaS3Config(env: Env, backendId: string = DEFAULT_BACKEND_ID): Promise<MediaS3Config | null> {
  try {
    const value = await getStoredValue(env, backendId);
    if (!value) return null;
    const parsed = parseStored(value);
    if (!parsed) return null;
    let secretAccessKey: string;
    try {
      secretAccessKey = await openWithSecret(env.SESSION_SECRET, parsed.secretAccessKeyEnc, CRYPTO_DOMAIN);
    } catch (err) {
      console.error('[mediaS3Config] 密钥解密失败（SESSION_SECRET 是否已轮换？需重新保存密钥）：', err);
      return null;
    }
    return {
      endpoint: parsed.endpoint.replace(/\/+$/, ''),
      region: parsed.region || 'auto',
      bucket: parsed.bucket,
      accessKeyId: parsed.accessKeyId,
      secretAccessKey,
      prefix: parsed.prefix || '',
    };
  } catch (err) {
    console.error('[mediaS3Config] 读取失败：', err);
    return null;
  }
}

/** 读取脱敏配置（前端展示用）：secret 只回尾 4 位 */
export async function getMediaS3ConfigPublic(env: Env, backendId: string = DEFAULT_BACKEND_ID): Promise<MediaS3ConfigPublic | null> {
  try {
    const value = await getStoredValue(env, backendId);
    if (!value) return null;
    const parsed = parseStored(value);
    if (!parsed) return null;
    let masked = '';
    try {
      masked = maskSecret(await openWithSecret(env.SESSION_SECRET, parsed.secretAccessKeyEnc, CRYPTO_DOMAIN));
    } catch {
      masked = '****';
    }
    return {
      endpoint: parsed.endpoint || '',
      region: parsed.region || 'auto',
      bucket: parsed.bucket || '',
      accessKeyIdMasked: maskSecret(parsed.accessKeyId),
      prefix: parsed.prefix || '',
      configured: true,
    };
  } catch {
    return null;
  }
}

export interface MediaS3ConfigInput {
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  /** 传空表示沿用已存密钥（首次保存必须提供） */
  secretAccessKey: string;
  prefix?: string;
}

/** 首次保存未提供 secretAccessKey 且无存量密钥可沿用（audit m-02：路由层按类型识别，不再文本匹配 message） */
export class MissingSecretError extends Error {
  constructor() {
    super('首次保存必须提供 secretAccessKey');
    this.name = 'MissingSecretError';
  }
}

/**
 * 读取存量配置用于「secret 留空沿用」。
 *
 * 必须走 getStoredValue 而非直接读分键：存量用户升级后分键尚未建立（仅在读路径
 * 触发迁移），若 save 只读分键会得到 null → 抛 MissingSecretError，用户的密钥被迫
 * 重填（等于凭据丢失）。getStoredValue 内含历史单桶键回退 + 迁移。
 */
async function readExistingStored(env: Env, backendId: string): Promise<z.infer<typeof storedSchema> | null> {
  const value = await getStoredValue(env, backendId);
  return value ? parseStored(value) : null;
}

export async function saveMediaS3Config(env: Env, input: MediaS3ConfigInput, backendId: string = DEFAULT_BACKEND_ID): Promise<void> {
  const prev = await readExistingStored(env, backendId);
  const secretAccessKeyEnc = input.secretAccessKey
    ? await sealWithSecret(env.SESSION_SECRET, input.secretAccessKey, CRYPTO_DOMAIN)
    : (prev?.secretAccessKeyEnc || '');
  if (!secretAccessKeyEnc) throw new MissingSecretError();
  const stored = {
    endpoint: input.endpoint.replace(/\/+$/, ''),
    region: input.region || 'auto',
    bucket: input.bucket,
    accessKeyId: input.accessKeyId,
    secretAccessKeyEnc,
    prefix: input.prefix || '',
  };
  await saveSettingRaw(env.DB, storageKey(backendId), JSON.stringify(stored));
}

export async function deleteMediaS3Config(env: Env, backendId: string = DEFAULT_BACKEND_ID): Promise<void> {
  await saveSettingRaw(env.DB, storageKey(backendId), '');
}
