// 缓冲层 S3 配置存取（D1 app_settings）+ 密钥 AES-GCM 加密
// 加密密钥由 SESSION_SECRET 派生（带领域标签），避免新增 secret
import type { Env } from '../env';
import { openWithSecret, sealWithSecret } from './crypto.service';
import { getSettingRaw, saveSettingRaw } from './settings.service';

export interface BufferConfig {
  enabled: boolean;
  endpoint: string;       // https://s3.xxx.com（路径风格）
  region: string;         // R2 固定 auto
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string; // 明文仅在内存；落库为密文
  prefix: string;          // 默认 tmp/blog
  rand: string;            // 16 字节随机十六进制，key 不可发现段
}

export interface BufferConfigPublic {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKeyMasked: string; // 仅展示尾 4 位
  prefix: string;
  rand: string;
}

const CONFIG_KEY = 'buffer_config';
const DEFAULT_PREFIX = 'tmp/blog';
const CRYPTO_DOMAIN = 'buffer-config:';

function maskSecret(s: string): string {
  if (!s) return '';
  return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
}

interface StoredConfig extends Omit<BufferConfig, 'secretAccessKey'> {
  secretAccessKeyEnc: string;
}

export async function getBufferConfig(env: Env): Promise<BufferConfig | null> {
  try {
    const value = await getSettingRaw(env.DB, CONFIG_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredConfig;
    // enabled 不作为配置是否"存在/可读"的硬条件：否则用户首次未勾选启用保存的配置（enabled:false 且无密钥）
    // 会在后续"启用 + 留空密钥沿用"场景被当作不存在，导致 saveBufferConfig 拿不到 prev 永远报「缺少 secretAccessKey」。
    // 只要求存储字段齐全即可返回；启用与否由 requireBufferConfig 在业务层判断。
    if (!parsed.endpoint || !parsed.bucket || !parsed.secretAccessKeyEnc) return null;
    let secretAccessKey: string;
    try {
      secretAccessKey = await openWithSecret(env.SESSION_SECRET, parsed.secretAccessKeyEnc, CRYPTO_DOMAIN);
    } catch (err) {
      console.error('[bufferConfig] 密钥解密失败（SESSION_SECRET 是否已轮换？需重新保存密钥）:', err);
      return null;
    }
    return {
      enabled: parsed.enabled === true,
      endpoint: parsed.endpoint.replace(/\/+$/, ''),
      region: parsed.region || 'auto',
      bucket: parsed.bucket,
      accessKeyId: parsed.accessKeyId || '',
      secretAccessKey,
      prefix: parsed.prefix || DEFAULT_PREFIX,
      rand: parsed.rand || '',
    };
  } catch (err) {
    console.error('[bufferConfig] 读取失败:', err);
    return null;
  }
}

export async function getBufferConfigPublic(env: Env): Promise<BufferConfigPublic | null> {
  try {
    const value = await getSettingRaw(env.DB, CONFIG_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredConfig;
    let masked = '';
    try {
      masked = maskSecret(await openWithSecret(env.SESSION_SECRET, parsed.secretAccessKeyEnc, CRYPTO_DOMAIN));
    } catch {
      masked = '****';
    }
    return {
      enabled: parsed.enabled === true,
      endpoint: parsed.endpoint || '',
      region: parsed.region || 'auto',
      bucket: parsed.bucket || '',
      accessKeyId: parsed.accessKeyId || '',
      secretAccessKeyMasked: masked,
      prefix: parsed.prefix || DEFAULT_PREFIX,
      rand: parsed.rand || '',
    };
  } catch {
    return null;
  }
}

export interface BufferConfigInput {
  enabled: boolean;
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string; // 传空表示沿用已存密钥
  prefix?: string;
}

export async function saveBufferConfig(env: Env, input: BufferConfigInput): Promise<void> {
  const existingValue = await getSettingRaw(env.DB, CONFIG_KEY);
  let prev: StoredConfig | null = null;
  if (existingValue) {
    try { prev = JSON.parse(existingValue) as StoredConfig; } catch { /* ignore */ }
  }
  const secretAccessKeyEnc = input.secretAccessKey
    ? await sealWithSecret(env.SESSION_SECRET, input.secretAccessKey, CRYPTO_DOMAIN)
    : (prev?.secretAccessKeyEnc || '');
  if (input.enabled && !secretAccessKeyEnc) throw new Error('缺少 secretAccessKey');
  const rand = prev?.rand || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const stored: StoredConfig = {
    enabled: input.enabled === true,
    endpoint: input.endpoint.replace(/\/+$/, ''),
    region: input.region || 'auto',
    bucket: input.bucket,
    accessKeyId: input.accessKeyId,
    secretAccessKeyEnc,
    prefix: input.prefix || DEFAULT_PREFIX,
    rand,
  };
  await saveSettingRaw(env.DB, CONFIG_KEY, JSON.stringify(stored));
}
