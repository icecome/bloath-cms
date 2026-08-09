// Session 管理：加密、签名、设备指纹
import type { Env } from './github';

// 生成设备指纹（基于 User-Agent 和 Accept-Language）
export async function generateDeviceFingerprint(request: Request): Promise<string> {
  const ua = request.headers.get('User-Agent') || '';
  const lang = request.headers.get('Accept-Language') || '';
  const data = `${ua.slice(0, 50)}|${lang}`;
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bytesToHex(new Uint8Array(hash).slice(0, 8));
}

// AES-GCM 加密生成 session token
export async function generateSessionToken(githubToken: string, env: Env, deviceFingerprint?: string): Promise<string | Response> {
  const expiresAt = Date.now() + 21600000; // 6 小时
  const payload = JSON.stringify({ githubToken, expiresAt, deviceFingerprint });

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

// AES-GCM 解密验证 session token，返回验证结果和是否需要续期
export async function validateSessionToken(sessionToken: string, env: Env, currentFingerprint?: string): Promise<{ githubToken: string; needsRenewal: boolean } | null> {
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

    if (Date.now() > sessionPayload.expiresAt) return null;

    if (deviceFingerprint && currentFingerprint && deviceFingerprint !== currentFingerprint) {
      return null;
    }

    const remaining = sessionPayload.expiresAt - Date.now();
    const totalDuration = 21600000; // 6 小时
    const needsRenewal = remaining < totalDuration / 2;

    return { githubToken: sessionPayload.githubToken, needsRenewal };
  } catch {
    return null;
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
