// 媒体库 S3 配置存取（D1 app_settings）+ 密钥 AES-GCM 加密。
//
// 迁移背景（P1-001）：此前媒体库 S3 的 AccessKey/Secret 明文存浏览器 localStorage
// 并以 aws4fetch 浏览器直连签名——任何 XSS 即可整桶端走；且推送配置到仓库时
// 凭据可能被写进公开文件（repoConfigSync 已双侧剥离，但存储面本身就该收掉）。
// 迁移后凭据仅存 Worker 侧（加密），上传/列表/删除经 /api/media/s3/* 代理执行，
// secret 永不回传浏览器。
//
// 与 bufferConfig.service 同构：sealWithSecret/openWithSecret + 领域标签分离 +
// 读侧 zod 结构校验（共享表防御脏数据，AGENTS.md 约定）。
import { z } from 'zod';
import type { Env } from '../env';
import { openWithSecret, sealWithSecret } from './crypto.service';
import { getSettingRaw, saveSettingRaw } from './settings.service';

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

const CONFIG_KEY = 'media_s3_config';
const CRYPTO_DOMAIN = 'media-s3-config:';

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

/** 读取完整配置（含解密后的 secret）；未配置/解密失败返回 null */
export async function getMediaS3Config(env: Env): Promise<MediaS3Config | null> {
  try {
    const value = await getSettingRaw(env.DB, CONFIG_KEY);
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
export async function getMediaS3ConfigPublic(env: Env): Promise<MediaS3ConfigPublic | null> {
  try {
    const value = await getSettingRaw(env.DB, CONFIG_KEY);
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

export async function saveMediaS3Config(env: Env, input: MediaS3ConfigInput): Promise<void> {
  const existingValue = await getSettingRaw(env.DB, CONFIG_KEY);
  let prev: z.infer<typeof storedSchema> | null = null;
  if (existingValue) {
    prev = parseStored(existingValue);
  }
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
  await saveSettingRaw(env.DB, CONFIG_KEY, JSON.stringify(stored));
}

export async function deleteMediaS3Config(env: Env): Promise<void> {
  await saveSettingRaw(env.DB, CONFIG_KEY, '');
}
