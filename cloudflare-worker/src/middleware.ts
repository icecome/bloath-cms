// 中间件：CORS、安全头、认证、路径校验
import type { Env } from './github';
import { validateSessionToken, generateDeviceFingerprint, generateSessionToken } from './session';

// 路径参数安全校验：白名单模式，仅允许字母、数字、中文、点、连字符、下划线、斜杠
export function isSafePathParam(value: string | null | undefined, allowSlash = false): value is string {
  if (!value) return false;
  if (value.includes('..')) return false;
  if (value.includes('\0')) return false;
  const pattern = allowSlash ? /^[a-zA-Z0-9\u4e00-\u9fff._/\-]+$/ : /^[a-zA-Z0-9\u4e00-\u9fff._\-]+$/;
  return pattern.test(value);
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

// 认证中间件 - 从 Cookie 读取 session token 并验证
export async function authenticate(request: Request, env: Env): Promise<{ githubToken: string; needsRenewal: boolean } | Response> {
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
  return result;
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

// 辅助函数：为响应添加自动续期 Cookie
export async function addSessionRenewalCookie(
  response: Response,
  authResult: { githubToken: string; needsRenewal: boolean },
  env: Env,
  isSecure: boolean,
  deviceFingerprint?: string
): Promise<Response> {
  if (authResult.needsRenewal) {
    const newToken = await generateSessionToken(authResult.githubToken, env, deviceFingerprint);
    if (typeof newToken === 'string') {
      response.headers.set('Set-Cookie', buildSessionCookie(newToken, 21600, isSecure));
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
