// 会话认证：Cookie / CSRF / OAuth 会话校验 / 中间件
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { HonoEnv } from '../env';
import {
  validateSessionToken, generateDeviceFingerprint, generateSessionToken,
  getDeviceRecord, upsertDeviceRecord, SESSION_DURATION_MS, TRUSTED_DURATION_MS
} from '../services/session';
import { ErrorCode } from '../comment/types';
import { error as errorResp } from '../comment/utils/response';

export function checkCsrf(request: Request): boolean {
  return request.headers.get('X-Requested-With') === 'XMLHttpRequest';
}

export function getSessionTokenFromCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildSessionCookie(token: string, maxAge: number, isSecure: boolean): string {
  // 生产 https 下用 SameSite=None; Secure，允许 bloath.icecome.com 跨站 fetch 带 cookie 访问 *.api.icecome.com。
  // 本地 http 保持 Lax。CSRF 由 checkCsrf（X-Requested-With）防护。
  const sameSite = isSecure ? 'None' : 'Lax';
  const parts = [`session=${encodeURIComponent(token)}`, 'Path=/api', `Max-Age=${maxAge}`, 'HttpOnly', `SameSite=${sameSite}`];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

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

export const requireAuth: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const authResult = await authenticate(c.req.raw, c.env);
  if (authResult instanceof Response) return authResult;
  c.set('auth', authResult);
  await next();
};

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

export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  if ((c.env as Record<string, unknown> | undefined)?.ENVIRONMENT !== 'production') {
    console.log(`[request] ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
  }
};
