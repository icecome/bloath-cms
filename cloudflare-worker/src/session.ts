// Session 管理：加密、签名、设备指纹、设备名单（KV）
import type { Env } from './github';

// 会话有效期：普通设备 6 小时，受信任设备 7 天
export const SESSION_DURATION_MS = 6 * 60 * 60 * 1000;
export const TRUSTED_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// KV 设备名单：7 天无活动自动清理
export const DEVICE_INACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_KEY_PREFIX = 'device:';

// 从 UA 中提取稳定内核族标识（忽略浏览器小版本号/build，增强稳定性）
function parseStableUa(ua: string): string {
  const lower = ua.toLowerCase();
  const brands = ['edg/', 'opr/', 'crios/', 'fxios/', 'firefox/', 'chrome/', 'safari/'];
  for (const brand of brands) {
    const idx = lower.indexOf(brand);
    if (idx >= 0) {
      const rest = lower.slice(idx + brand.length);
      const major = rest.match(/^\d{1,3}/)?.[0] || '';
      return `${brand}${major}`;
    }
  }
  return ua.slice(0, 24);
}

// 生成设备指纹（内核族 + 语言，浏览器升级不再轻易变指纹）
export async function generateDeviceFingerprint(request: Request): Promise<string> {
  const ua = request.headers.get('User-Agent') || '';
  const lang = request.headers.get('Accept-Language') || '';
  const data = `${parseStableUa(ua)}|${lang}`;
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bytesToHex(new Uint8Array(hash).slice(0, 8));
}

// AES-GCM 加密生成 session token（longLived=true 时有效期 7 天，否则 6 小时）
export async function generateSessionToken(
  githubToken: string,
  env: Env,
  deviceFingerprint?: string,
  longLived = false
): Promise<string | Response> {
  const issuedAt = Date.now();
  const duration = longLived ? TRUSTED_DURATION_MS : SESSION_DURATION_MS;
  const expiresAt = issuedAt + duration;
  const payload = JSON.stringify({ githubToken, expiresAt, deviceFingerprint, longLived, issuedAt });

  const secretKey = env.SESSION_SECRET;
  if (!secretKey) {
    return Response.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const keyBytes = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(payload)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

// AES-GCM 解密验证 session token，返回验证结果、续期时长与设备信任标记
export interface SessionPayload {
  githubToken: string;
  needsRenewal: boolean;
  /** token 快照中的信任标记（最终以 KV 名单为准，见 middleware） */
  longLived: boolean;
  issuedAt: number;
}

export async function validateSessionToken(
  sessionToken: string,
  env: Env,
  currentFingerprint?: string
): Promise<SessionPayload | null> {
  try {
    const secretKey = env.SESSION_SECRET;
    if (!secretKey) return null;

    const combined = Uint8Array.from(atob(sessionToken), c => c.charCodeAt(0));
    if (combined.length < 12) return null;

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const encoder = new TextEncoder();
    const keyBytes = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const payload = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
    if (typeof payload !== 'object' || payload === null) return null;

    const sessionPayload = payload as Record<string, unknown>;
    if (typeof sessionPayload.githubToken !== 'string' ||
        typeof sessionPayload.expiresAt !== 'number') return null;

    const deviceFingerprint = typeof sessionPayload.deviceFingerprint === 'string'
      ? sessionPayload.deviceFingerprint
      : undefined;
    // 向后兼容：旧 token 无 longLived/issuedAt 字段
    const longLived = sessionPayload.longLived === true;
    const issuedAt = typeof sessionPayload.issuedAt === 'number'
      ? sessionPayload.issuedAt
      : sessionPayload.expiresAt;

    if (Date.now() > sessionPayload.expiresAt) return null;

    if (deviceFingerprint && currentFingerprint && deviceFingerprint !== currentFingerprint) {
      return null;
    }

    const remaining = sessionPayload.expiresAt - Date.now();
    const totalDuration = longLived ? TRUSTED_DURATION_MS : SESSION_DURATION_MS;
    const needsRenewal = remaining < totalDuration / 2;

    return {
      githubToken: sessionPayload.githubToken,
      needsRenewal,
      longLived,
      issuedAt
    };
  } catch {
    return null;
  }
}

// ---------- KV 设备名单 ----------

interface DeviceRecord {
  trusted: boolean;
  lastSeenAt: number;
  /** UA 描述字符串（仅用于列表展示，非安全依赖） */
  ua?: string;
}

// 读取设备记录；7 天无活动自动清理（视为新设备）
export async function getDeviceRecord(
  kv: KVNamespace,
  fingerprint: string
): Promise<DeviceRecord> {
  try {
    const raw = await kv.get(DEVICE_KEY_PREFIX + fingerprint);
    if (!raw) return { trusted: false, lastSeenAt: 0 };
    const parsed = JSON.parse(raw) as DeviceRecord;
    if (Date.now() - (parsed.lastSeenAt || 0) > DEVICE_INACTIVE_MS) {
      await kv.delete(DEVICE_KEY_PREFIX + fingerprint).catch(() => undefined);
      return { trusted: false, lastSeenAt: 0 };
    }
    return {
      trusted: parsed.trusted === true,
      lastSeenAt: parsed.lastSeenAt || 0,
      ua: typeof parsed.ua === 'string' ? parsed.ua : undefined
    };
  } catch {
    return { trusted: false, lastSeenAt: 0 };
  }
}

// 写入/更新设备记录（登录、续期、勾选信任）
export async function upsertDeviceRecord(
  kv: KVNamespace,
  fingerprint: string,
  lastSeenAt: number,
  trusted: boolean,
  ua?: string
): Promise<void> {
  try {
    const record: DeviceRecord = { trusted, lastSeenAt };
    if (ua) record.ua = ua;
    await kv.put(DEVICE_KEY_PREFIX + fingerprint, JSON.stringify(record));
  } catch {
    // 名单写入失败不影响主流程
  }
}

// 列出所有设备记录（含已过期未清理的，过滤后返回）
export async function listDeviceRecords(kv: KVNamespace): Promise<Array<{ fingerprint: string } & DeviceRecord>> {
  try {
    const list = await kv.list({ prefix: DEVICE_KEY_PREFIX });
    const results: Array<{ fingerprint: string } & DeviceRecord> = [];
    for (const key of list.keys) {
      if (!key.name.startsWith(DEVICE_KEY_PREFIX)) continue;
      const fingerprint = key.name.slice(DEVICE_KEY_PREFIX.length);
      const raw = await kv.get(key.name);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as DeviceRecord;
        if (Date.now() - (parsed.lastSeenAt || 0) > DEVICE_INACTIVE_MS) continue;
        results.push({
          fingerprint,
          trusted: parsed.trusted === true,
          lastSeenAt: parsed.lastSeenAt || 0,
          ua: typeof parsed.ua === 'string' ? parsed.ua : undefined
        });
      } catch { /* skip invalid */ }
    }
    return results.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  } catch {
    return [];
  }
}

// 删除指定设备记录
export async function deleteDeviceRecord(
  kv: KVNamespace,
  fingerprint: string
): Promise<boolean> {
  try {
    await kv.delete(DEVICE_KEY_PREFIX + fingerprint);
    return true;
  } catch {
    return false;
  }
}

// 生成带签名的 state，编码 frontendUrl 和时间戳
// 格式：frontendUrl:randomPart:timestamp:signature
export async function generateState(frontendUrl: string, env: Env): Promise<string> {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const randomPart = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const timestamp = Date.now().toString();
  const payload = `${frontendUrl}:${randomPart}:${timestamp}`;
  const encoder = new TextEncoder();
  const secretKey = env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET not configured');
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  const key = await crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigHex = bytesToHex(new Uint8Array(signature));
  return `${payload}:${sigHex}`;
}

// 验证并解析 state（带 HMAC 签名校验和时间戳验证）
export async function parseState(state: string, env: Env): Promise<{ frontendUrl: string; valid: boolean }> {
  const parts = state.split(':');
  if (parts.length < 4) return { frontendUrl: '', valid: false };

  const timestamp = parts[parts.length - 2];
  const sigHex = parts[parts.length - 1];
  const randomPart = parts[parts.length - 3];
  const frontendUrl = parts.slice(0, -3).join(':');

  const stateTimestamp = parseInt(timestamp, 10);
  if (isNaN(stateTimestamp)) {
    return { frontendUrl: '', valid: false };
  }
  const now = Date.now();
  const STATE_EXPIRY = 10 * 60 * 1000;
  if (now - stateTimestamp > STATE_EXPIRY) {
    return { frontendUrl: '', valid: false };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(frontendUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { frontendUrl: '', valid: false };
    }
  } catch {
    return { frontendUrl: '', valid: false };
  }

  const encoder = new TextEncoder();
  const payload = `${frontendUrl}:${randomPart}:${timestamp}`;
  const secretKey = env.SESSION_SECRET;
  if (!secretKey) {
    return { frontendUrl: '', valid: false };
  }
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));

  try {
    const key = await crypto.subtle.importKey('raw', keyHash, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = hexToUint8Array(sigHex);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
    return { frontendUrl, valid };
  } catch {
    return { frontendUrl: '', valid: false };
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >> 1] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
