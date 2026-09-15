import type { HonoEnv } from '../env';
import type { Context, Next, MiddlewareHandler } from 'hono';
import {
  validateSessionToken, generateDeviceFingerprint, generateSessionToken,
  getDeviceRecord, upsertDeviceRecord, SESSION_DURATION_MS, TRUSTED_DURATION_MS
} from '../services/session';
import { ErrorCode } from '../comment/types';
import { error as errorResp } from '../comment/utils/response';

// ---------- 路径参数安全校验 ----------
const PATH_SAFE_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff._\-]+$/;
const PATH_SAFE_PATTERN_WITH_SLASH = /^[a-zA-Z0-9\u4e00-\u9fff._/\-]+$/;

export function isSafePathParam(value: string | null | undefined, allowSlash = false): value is string {
  if (!value) return false;
  if (value.includes('..')) return false;
  if (value.includes('\0')) return false;
  return allowSlash ? PATH_SAFE_PATTERN_WITH_SLASH.test(value) : PATH_SAFE_PATTERN.test(value);
}

// ---------- 安全 JSON 解析 ----------
export function safeJsonParse(text: string): Record<string, unknown> {
  if (text.length > 20 * 1024 * 1024) throw new Error('JSON payload too large');
  const obj = JSON.parse(text) as Record<string, unknown>;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid JSON payload');
  const safeObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') safeObj[key] = value;
  }
  return safeObj;
}

export const MAX_CONTENT_SIZE = 10 * 1024 * 1024;

// ---------- CSRF ----------
export function checkCsrf(request: Request): boolean {
  return request.headers.get('X-Requested-With') === 'XMLHttpRequest';
}

// ---------- Cookie ----------
export function getSessionTokenFromCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildSessionCookie(token: string, maxAge: number, isSecure: boolean): string {
  const parts = [`session=${encodeURIComponent(token)}`, 'Path=/api', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

// ---------- OAuth 会话认证（编辑器） ----------
export interface AuthResult {
  githubToken: string;
  needsRenewal: boolean;
  trusted: boolean;
  longLived: boolean;
  issuedAt: number;
  deviceFingerprint: string;
}

export async function authenticate(request: Request, env: HonoEnv['Bindings']): Promise<AuthResult | Response> {
  if (!checkCsrf(request)) return Response.json({ error: 'CSRF validation failed' }, { status: 403 });
  const sessionToken = getSessionTokenFromCookie(request);
  if (!sessionToken) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const currentFingerprint = await generateDeviceFingerprint(request);
  const result = await validateSessionToken(sessionToken, env, currentFingerprint);
  if (!result) return Response.json({ error: 'Session expired' }, { status: 401 });
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

// ---------- Hono 中间件：编辑器 OAuth 认证 ----------
export const requireAuth: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const authResult = await authenticate(c.req.raw, c.env);
  if (authResult instanceof Response) return authResult;
  c.set('auth', authResult);
  await next();
};

// ---------- Hono 中间件：留言管理面 OAuth 认证（不依赖 githubToken） ----------
export const requireAdminAuth: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  if (!checkCsrf(c.req.raw)) {
    return c.json(errorResp(ErrorCode.VALIDATION_ERROR, 'CSRF validation failed'), 403);
  }
  const sessionToken = getSessionTokenFromCookie(c.req.raw);
  if (!sessionToken) {
    return c.json(errorResp(ErrorCode.UNAUTHORIZED, '未登录或会话已过期'), 401);
  }
  const currentFingerprint = await generateDeviceFingerprint(c.req.raw);
  const result = await validateSessionToken(sessionToken, c.env, currentFingerprint);
  if (!result) {
    return c.json(errorResp(ErrorCode.UNAUTHORIZED, '未登录或会话已过期'), 401);
  }
  await next();
};

// ---------- 续期 Cookie ----------
export async function addSessionRenewalCookie(
  response: Response,
  authResult: AuthResult,
  env: HonoEnv['Bindings'],
  isSecure: boolean
): Promise<Response> {
  if (authResult.needsRenewal) {
    const newToken = await generateSessionToken(authResult.githubToken, env, authResult.deviceFingerprint, authResult.trusted);
    if (typeof newToken === 'string') {
      const maxAge = authResult.trusted ? TRUSTED_DURATION_MS / 1000 : SESSION_DURATION_MS / 1000;
      response.headers.set('Set-Cookie', buildSessionCookie(newToken, maxAge, isSecure));
    }
  }
  return response;
}

// ---------- CORS ----------
export function getAllowedOrigins(env: HonoEnv['Bindings']): string[] {
  const customOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  const corsOrigin = (env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
  const defaultOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:5173'];
  const prodOrigins = env.PROD_ORIGINS ? env.PROD_ORIGINS.split(',').map(o => o.trim()).filter(Boolean) : [];
  return [...defaultOrigins, ...customOrigins, ...corsOrigin, ...prodOrigins];
}

export function isAllowedFrontendUrl(rawUrl: string, env: HonoEnv['Bindings']): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  return getAllowedOrigins(env).includes(rawUrl);
}

export function corsHeaders(origin: string, env: HonoEnv['Bindings']): Headers | null {
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

export function addSecurityHeaders(response: Response, env: HonoEnv['Bindings']): Response {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  const csp = env.CONTENT_SECURITY_POLICY || "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https://api.github.com https://github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export function addCorsHeaders(response: Response, origin: string, env: HonoEnv['Bindings']): Response {
  const cors = corsHeaders(origin, env);
  if (!cors) return response;
  cors.forEach((value, key) => response.headers.set(key, value));
  addSecurityHeaders(response, env);
  return response;
}

// ---------- Hono 中间件：CORS ----------
export const corsMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const origin = c.req.header('Origin') || '';
  if (c.req.method === 'OPTIONS') {
    const cors = corsHeaders(origin, c.env);
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }
  await next();
  const cors = corsHeaders(origin, c.env);
  if (cors) {
    cors.forEach((value, key) => c.res.headers.set(key, value));
  }
  addSecurityHeaders(c.res, c.env);
};

// ---------- Hono 中间件：请求日志 ----------
export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  if ((c.env as Record<string, unknown> | undefined)?.ENVIRONMENT !== 'production') {
    console.log(`[request] ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
  }
};
