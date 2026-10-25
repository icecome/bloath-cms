// 会话认证：Cookie / CSRF / OAuth 会话校验 / 中间件
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { HonoEnv } from '../env';
import {
  validateSessionToken, generateDeviceFingerprint,
  getDeviceRecord, upsertDeviceRecord, DEVICE_ACTIVE_WRITE_THROTTLE_MS
} from '../services/session';
import { isLoginAllowed } from '../services/owner-allowlist';

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
  /** 签发该会话的 GitHub 用户名（小写原样，比对时统一小写） */
  githubLogin: string;
  needsRenewal: boolean;
  trusted: boolean;
  longLived: boolean;
  issuedAt: number;
  /** 绝对寿命锚点（首签时刻），续期透传与上限判断依赖（P2-29） */
  firstIssuedAt: number;
  deviceFingerprint: string;
}

export async function authenticate(request: Request, env: HonoEnv['Bindings']): Promise<AuthResult | Response> {
  if (!checkCsrf(request)) return Response.json({ error: '请求来源校验未通过，请刷新页面后重试' }, { status: 403 });
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
    // 活跃回写节流（M-P1）：距上次活跃 < 10 分钟时跳过 KV 写。
    // KV 免费层每日 10 万写，每请求 upsert 会打穿配额，殃及同 KV 的
    // 登出吊销写入；节流的代价仅是设备列表活跃时间精度降为分钟级。
    if (Date.now() - lastSeenAt >= DEVICE_ACTIVE_WRITE_THROTTLE_MS) {
      const ua = request.headers.get('User-Agent') || '';
      await upsertDeviceRecord(env.DEVICES_KV, currentFingerprint, Date.now(), trusted, ua || undefined);
    }
  }
  return {
    githubToken: result.githubToken,
    githubLogin: result.githubLogin,
    needsRenewal: result.needsRenewal,
    trusted,
    longLived: trusted,
    issuedAt: lastSeenAt,
    firstIssuedAt: result.firstIssuedAt,
    deviceFingerprint: currentFingerprint
  };
}

export const requireAuth: MiddlewareHandler<HonoEnv> = async (c: Context<HonoEnv>, next: Next) => {
  const authResult = await authenticate(c.req.raw, c.env);
  if (authResult instanceof Response) return authResult;
  // 第二层所有者校验：callback 白名单之外，这里兜底拦截「白名单放开前签发的
  // 旧会话」与未来新增路由漏配守卫的情况。非白名单登录态一律视同未认证。
  if (!isLoginAllowed(authResult.githubLogin, c.env)) {
    return Response.json({ error: 'Session expired' }, { status: 401 });
  }
  c.set('auth', authResult);
  await next();
};

// requireAdminAuth（管理接口白名单守卫）随留言管理模块一并移除：
// 它是 /api/admin/* 的唯一消费者，该模块下线后已无调用点。
// addSessionRenewalCookie 同批删除（audit n-01）：续期 cookie 现直接在各端点的
// Response 上设置（logout/auth/device 等），本函数全仓零调用，属死代码。
// 其中「绝对寿命上限内静默跳过续期」的语义已由 validateSessionToken 的
// firstIssuedAt 透传 + 判活端点不续期（P2-29）覆盖。

export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  if ((c.env as Record<string, unknown> | undefined)?.ENVIRONMENT !== 'production') {
    console.log(`[request] ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
  }
};
