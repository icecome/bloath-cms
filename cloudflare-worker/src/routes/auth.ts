import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../comment/types';
import { success, error } from '../comment/utils/response';
import { exchangeCode, getUserInfo } from '../services/github';
import {
  generateState, parseState, generateDeviceFingerprint, generateSessionToken,
  validateSessionToken, revokeSessions,
  getDeviceRecord, upsertDeviceRecord, listDeviceRecords, deleteDeviceRecord,
  SESSION_DURATION_MS, TRUSTED_DURATION_MS,
} from '../services/session';
import {
  authenticate, buildSessionCookie, addSessionRenewalCookie,
  checkCsrf, getSessionTokenFromCookie,
} from '../middleware/sessionAuth';
import { isAllowedFrontendUrl, resolveFrontendUrl, addSecurityHeaders } from '../middleware/cors';
import { safeJsonParse } from '../middleware/pathGuard';

const authApp = new Hono<HonoEnv>();

// GET /api/auth/dev-login — 仅本地开发：跳过 GitHub OAuth 直接签发会话
// 返回 200 HTML，Cookie 由 JS 在当前域写入（避免 Vite 代理转发 302 时丢失 Set-Cookie）
// 不绑定设备指纹：浏览器导航与后续 fetch 的请求头可能经 Vite 代理后不一致，导致指纹校验失败
// 注入的 login 复用 ADMIN_GITHUB_LOGIN 首项（若配置），使本地也能访问管理接口
authApp.get('/api/auth/dev-login', async (c: Context<HonoEnv>) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }
  const fakeToken = 'dev-local-no-github';
  const devLogin = (c.env.ADMIN_GITHUB_LOGIN || 'dev-user').split(',')[0]?.trim() || 'dev-user';
  const sessionToken = await generateSessionToken(fakeToken, devLogin, c.env, undefined, true);
  if (typeof sessionToken !== 'string') {
    return c.json({ error: 'Session generation failed' }, 500);
  }
  const encoded = encodeURIComponent(sessionToken);
  const html = `<!DOCTYPE html><html><head><title>Dev Login</title></head><body>
<p>正在登录...</p>
<script>
document.cookie = 'session=${encoded}; path=/api; max-age=604800; SameSite=Lax';
location.href = '/';
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// GET /api/auth/login
authApp.get('/api/auth/login', async (c: Context<HonoEnv>) => {
  const url = new URL(c.req.url);
  const workerUrl = url.origin.startsWith('http://localhost') ? 'http://localhost:8787' : url.origin;
  // 回调跳转目标只取服务端配置。不接受请求头（X-Frontend-Url / Origin）指定：
  // 头部由调用方控制，即便过白名单也只是把可选目标限制在白名单集合内，
  // 而本应用的合法前端只有一个，没有多目标选择的需求。
  const frontendUrl = resolveFrontendUrl(c.env);
  if (!frontendUrl) {
    console.error('[auth] FRONTEND_URL 未配置，无法发起登录');
    return c.json(error(ErrorCode.INTERNAL_ERROR, '服务端未配置前端地址'), 500);
  }
  const state = await generateState(frontendUrl, c.env);
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${c.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(workerUrl + '/api/auth/callback')}&scope=repo%20user:email&state=${state}&prompt=consent`;
  const response = c.json(success({ authUrl }));
  return response;
});

// GET /api/auth/callback
authApp.get('/api/auth/callback', async (c: Context<HonoEnv>) => {
  const url = new URL(c.req.url);
  const workerUrl = url.origin.startsWith('http://localhost') ? 'http://localhost:8787' : url.origin;
  const isSecure = url.protocol === 'https:';
  // 重定向目标只来自 state（HMAC 签名 + 10 分钟有效期 + 协议白名单），
  // 不再读取请求头：头部由调用方完全控制，是开放重定向的入口。
  const fallbackFrontendUrl = resolveFrontendUrl(c.env);

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    if (!fallbackFrontendUrl) return c.json(error(ErrorCode.INTERNAL_ERROR, '服务端未配置前端地址'), 500);
    return c.redirect(`${fallbackFrontendUrl}/login?error=invalid_request`, 302);
  }

  const stateData = await parseState(state, c.env);
  if (!stateData.valid) {
    if (!fallbackFrontendUrl) return c.json(error(ErrorCode.INTERNAL_ERROR, '服务端未配置前端地址'), 500);
    return c.redirect(`${fallbackFrontendUrl}/login?error=invalid_state`, 302);
  }

  // state 内的 frontendUrl 已验签，但仍需过白名单：签发时用的是当时的配置，
  // 配置收敛后旧 state 不应成为绕过白名单的通道。
  const storedFrontendUrl = stateData.frontendUrl && isAllowedFrontendUrl(stateData.frontendUrl, c.env)
    ? stateData.frontendUrl
    : fallbackFrontendUrl;
  if (!storedFrontendUrl) {
    console.error('[auth] FRONTEND_URL 未配置且 state 内地址未通过白名单');
    return c.json(error(ErrorCode.INTERNAL_ERROR, '服务端未配置前端地址'), 500);
  }

  const accessToken = await exchangeCode(code, c.env.GITHUB_CLIENT_SECRET, c.env.GITHUB_CLIENT_ID, workerUrl + '/api/auth/callback');
  // 取登录名：既是会话身份凭据（管理接口白名单依赖它），也用于 /api/me 回显
  const user = await getUserInfo(accessToken);
  const deviceFingerprint = await generateDeviceFingerprint(c.req.raw);
  let longLived = false;
  if (c.env.DEVICES_KV) {
    const record = await getDeviceRecord(c.env.DEVICES_KV, deviceFingerprint);
    longLived = record.trusted;
    const ua = c.req.header('User-Agent') || '';
    await upsertDeviceRecord(c.env.DEVICES_KV, deviceFingerprint, Date.now(), longLived, ua || undefined);
  }
  const sessionTokenResult = await generateSessionToken(accessToken, user.login, c.env, deviceFingerprint, longLived);
  if (sessionTokenResult instanceof Response) return c.redirect(`${storedFrontendUrl}/login?error=server_error`, 302);

  const response = new Response(null, { status: 302, headers: { 'Location': storedFrontendUrl + '/' } });
  const maxAge = longLived ? TRUSTED_DURATION_MS / 1000 : SESSION_DURATION_MS / 1000;
  response.headers.set('Set-Cookie', buildSessionCookie(sessionTokenResult, maxAge, isSecure));
  return addSecurityHeaders(response, c.env);
});

// POST /api/auth/logout
authApp.post('/api/auth/logout', async (c: Context<HonoEnv>) => {
  if (!checkCsrf(c.req.raw)) {
    return c.json({ error: 'CSRF validation failed' }, 403);
  }
  // 服务端吊销：仅清 cookie 无法使被窃取的 token 失效，登出必须同时推进该账号的吊销门槛
  const sessionToken = getSessionTokenFromCookie(c.req.raw);
  if (sessionToken) {
    const session = await validateSessionToken(sessionToken, c.env, undefined);
    if (session) {
      await revokeSessions(c.env.DEVICES_KV, session.githubLogin);
    }
  }
  const url = new URL(c.req.url);
  const isSecure = url.protocol === 'https:';
  const response = c.json(success(null));
  response.headers.set('Set-Cookie', buildSessionCookie('', 0, isSecure));
  return response;
});

// GET /api/me — 会话探测（前端路由守卫）
// 本地 dev 模式下 dev-login 签发的 token 不绑定设备指纹，authenticate 会因指纹不匹配而拒绝；
// 这里在 authenticate 之前先手动探测 dev token，绕过指纹校验
authApp.get('/api/me', async (c: Context<HonoEnv>) => {
  if (!checkCsrf(c.req.raw)) {
    return c.json({ error: 'CSRF validation failed' }, 403);
  }
  const sessionToken = getSessionTokenFromCookie(c.req.raw);
  if (!sessionToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  // dev 模式快捷路径：直接解密 token，若 githubToken 为占位值则跳过设备指纹校验。
  // 必须显式限定非生产环境：dev-login 本身已有 404 守卫，此处是第二道独立防线，
  // 避免仅靠单一配置变量决定该路径是否可达。
  if (c.env.ENVIRONMENT !== 'production') {
    const devResult = await validateSessionToken(sessionToken, c.env, undefined);
    if (devResult && devResult.githubToken === 'dev-local-no-github') {
      return c.json(success({ user: { login: devResult.githubLogin, avatar_url: '', name: '本地开发' } }));
    }
  }
  // 正常路径：完整 authenticate（含设备指纹校验）
  const authResult = await authenticate(c.req.raw, c.env);
  if (authResult instanceof Response) return authResult;
  const user = await getUserInfo(authResult.githubToken);
  const url = new URL(c.req.url);
  const isSecure = url.protocol === 'https:';
  const response = c.json(success({ user: { login: user.login, avatar_url: user.avatar_url, name: user.name } }));
  return await addSessionRenewalCookie(response, authResult, c.env, isSecure);
});

// POST /api/auth/device — 切换信任
authApp.post('/api/auth/device', async (c: Context<HonoEnv>) => {
  const authResult = await authenticate(c.req.raw, c.env);
  if (authResult instanceof Response) return authResult;
  const data = safeJsonParse(await c.req.raw.text());
  const trusted = data.trusted === true;
  if (c.env.DEVICES_KV) {
    const ua = c.req.header('User-Agent') || '';
    await upsertDeviceRecord(c.env.DEVICES_KV, authResult.deviceFingerprint, Date.now(), trusted, ua || undefined);
  }
  const newToken = await generateSessionToken(
    authResult.githubToken, authResult.githubLogin, c.env, authResult.deviceFingerprint, trusted
  );
  if (typeof newToken !== 'string') return c.json(error(ErrorCode.INTERNAL_ERROR, '会话签发失败'), 500);
  const url = new URL(c.req.url);
  const isSecure = url.protocol === 'https:';
  const maxAge = trusted ? TRUSTED_DURATION_MS / 1000 : SESSION_DURATION_MS / 1000;
  const resp = c.json(success({ trusted }));
  resp.headers.set('Set-Cookie', buildSessionCookie(newToken, maxAge, isSecure));
  return resp;
});

// GET /api/auth/devices
authApp.get('/api/auth/devices', async (c: Context<HonoEnv>) => {
  const authResult = await authenticate(c.req.raw, c.env);
  if (authResult instanceof Response) return authResult;
  if (!c.env.DEVICES_KV) return c.json(success([]));
  const devices = await listDeviceRecords(c.env.DEVICES_KV);
  return c.json(success(devices.map(d => ({
    fingerprint: d.fingerprint, trusted: d.trusted, lastLoginAt: d.lastSeenAt,
    ua: d.ua || null, isCurrent: d.fingerprint === authResult.deviceFingerprint,
  }))));
});

// DELETE /api/auth/devices/:fingerprint
authApp.delete('/api/auth/devices/:fingerprint', async (c: Context<HonoEnv>) => {
  const authResult = await authenticate(c.req.raw, c.env);
  if (authResult instanceof Response) return authResult;
  const fingerprint = decodeURIComponent(c.req.param('fingerprint') || '');
  if (!fingerprint || !/^[a-f0-9]{16}$/i.test(fingerprint)) return c.json(error(ErrorCode.VALIDATION_ERROR, '无效的设备标识'), 400);
  if (fingerprint === authResult.deviceFingerprint) return c.json(error(ErrorCode.VALIDATION_ERROR, '不能删除当前设备，请使用登出'), 400);
  if (!c.env.DEVICES_KV) return c.json(error(ErrorCode.VALIDATION_ERROR, '设备管理未启用'), 400);
  const ok = await deleteDeviceRecord(c.env.DEVICES_KV, fingerprint);
  if (!ok) return c.json(error(ErrorCode.INTERNAL_ERROR, '删除失败'), 500);
  return c.body(null, 204);
});

export default authApp;
