// 中间件：CORS、安全头、认证、路径校验
import type { Env } from './github';
import {
  validateSessionToken, generateDeviceFingerprint, generateSessionToken,
  getDeviceRecord, upsertDeviceRecord, SESSION_DURATION_MS, TRUSTED_DURATION_MS
} from './session';

// 路径参数安全校验正则（白名单模式）
const PATH_SAFE_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff._\-]+$/;
const PATH_SAFE_PATTERN_WITH_SLASH = /^[a-zA-Z0-9\u4e00-\u9fff._/\-]+$/;

// 路径参数安全校验：白名单模式，仅允许字母、数字、中文、点、连字符、下划线、斜杠
export function isSafePathParam(value: string | null | undefined, allowSlash = false): value is string {
  if (!value) return false;
  if (value.includes('..')) return false;
  if (value.includes('\0')) return false;
  return allowSlash ? PATH_SAFE_PATTERN_WITH_SLASH.test(value) : PATH_SAFE_PATTERN.test(value);
}

// 安全的 JSON 解析，防止原型污染和 DoS 攻击
export function safeJsonParse(text: string): Record<string, unknown> {
  if (text.length > 20 * 1024 * 1024) {
    throw new Error('JSON payload too large');
  }
  const obj = JSON.parse(text) as Record<string, unknown>;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid JSON payload');
  }
  const safeObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      safeObj[key] = value;
    }
  }
  return safeObj;
}

// 内容大小限制 (10MB)
export const MAX_CONTENT_SIZE = 10 * 1024 * 1024;

// 从 Cookie 中解析 session token
export function getSessionTokenFromCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// CSRF 防护：校验自定义 header
export function checkCsrf(request: Request): boolean {
  return request.headers.get('X-Requested-With') === 'XMLHttpRequest';
}

export interface AuthResult {
  githubToken: string;
  needsRenewal: boolean;
  /** 设备是否受信任（决定续期时长：7 天 / 6 小时） */
  trusted: boolean;
  /** token 快照的信任标记（兼容无 KV 场景） */
  longLived: boolean;
  issuedAt: number;
  deviceFingerprint: string;
}

// 认证中间件 - 从 Cookie 读取并验证 session token；设备名单（KV）为准决定信任
export async function authenticate(request: Request, env: Env): Promise<AuthResult | Response> {
  if (!checkCsrf(request)) {
    return Response.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const sessionToken = getSessionTokenFromCookie(request);
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentFingerprint = await generateDeviceFingerprint(request);
  const result = await validateSessionToken(sessionToken, env, currentFingerprint);
  if (!result) {
    return Response.json({ error: 'Session expired' }, { status: 401 });
  }

  // 设备信任：有 KV 名单则以 KV 为准（支持 7 天无活动自动清理）；否则降级用 token 快照
  let trusted = result.longLived;
  let lastSeenAt = result.issuedAt;
  if (env.DEVICES_KV) {
    const record = await getDeviceRecord(env.DEVICES_KV, currentFingerprint);
    trusted = record.trusted;
    lastSeenAt = record.lastSeenAt || result.issuedAt;
    const ua = request.headers.get('User-Agent') || '';
    await upsertDeviceRecord(env.DEVICES_KV, currentFingerprint, Date.now(), trusted, ua || undefined);
  }

  return {
    githubToken: result.githubToken,
    needsRenewal: result.needsRenewal,
    trusted,
    longLived: trusted,
    issuedAt: lastSeenAt,
    deviceFingerprint: currentFingerprint
  };
}

// 构建 Set-Cookie 头的值
export function buildSessionCookie(token: string, maxAge: number, isSecure: boolean): string {
  const parts = [
    `session=${encodeURIComponent(token)}`,
    'Path=/api',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

// 辅助函数：为响应添加自动续期 Cookie（按设备信任决定时长）
export async function addSessionRenewalCookie(
  response: Response,
  authResult: AuthResult,
  env: Env,
  isSecure: boolean
): Promise<Response> {
  if (authResult.needsRenewal) {
    const trusted = authResult.trusted;
    const newToken = await generateSessionToken(authResult.githubToken, env, authResult.deviceFingerprint, trusted);
    if (typeof newToken === 'string') {
      const maxAge = trusted ? TRUSTED_DURATION_MS / 1000 : SESSION_DURATION_MS / 1000;
      response.headers.set('Set-Cookie', buildSessionCookie(newToken, maxAge, isSecure));
    }
  }
  return response;
}

// 获取允许的来源列表（开发环境 + 环境变量自定义 + 生产环境）
export function getAllowedOrigins(env: Env): string[] {
  const envOrigins = env.ALLOWED_ORIGINS || '';
  const customOrigins = envOrigins.split(',').map(o => o.trim()).filter(Boolean);
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:5173'
  ];
  const prodOrigins = env.PROD_ORIGINS
    ? env.PROD_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];
  return [...defaultOrigins, ...customOrigins, ...prodOrigins];
}

// 校验前端 URL 是否在白名单内，防止开放重定向
export function isAllowedFrontendUrl(rawUrl: string, env: Env): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  return getAllowedOrigins(env).includes(rawUrl);
}

export function corsHeaders(origin: string, env: Env): Headers | null {
  const allowedOrigins = getAllowedOrigins(env);
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : null;

  if (!allowedOrigin) return null;

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-Frontend-Url');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');

  return headers;
}

// 添加安全头（CSP + 通用安全头）
export function addSecurityHeaders(response: Response, env: Env): Response {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  const csp = env.CONTENT_SECURITY_POLICY || "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https://api.github.com https://github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

// 添加 CORS 头到响应
export function addCorsHeaders(response: Response, origin: string, env: Env): Response {
  const cors = corsHeaders(origin, env);
  if (!cors) return response;
  cors.forEach((value, key) => {
    response.headers.set(key, value);
  });
  addSecurityHeaders(response, env);
  return response;
}
