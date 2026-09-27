// CORS / CSP / 安全响应头
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../env';

export function getAllowedOrigins(env: HonoEnv['Bindings']): string[] {
  const customOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  const corsOrigin = (env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  // localhost 默认值仅用于本地开发：生产环境注入它们会让 http://localhost:5173 成为合法重定向目标
  const devOrigins = env.ENVIRONMENT !== 'production'
    ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:5173']
    : [];
  const prodOrigins = env.PROD_ORIGINS ? env.PROD_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : [];
  const frontendUrl = (env.FRONTEND_URL || '').trim();
  return [...devOrigins, ...customOrigins, ...corsOrigin, ...prodOrigins, ...(frontendUrl ? [frontendUrl] : [])];
}

/**
 * 判断原始 URL 是否属于前端白名单。
 * 用 new URL().origin 归一化后比对，避免尾斜杠/大小写/默认端口等变体绕过。
 */
export function isAllowedFrontendUrl(rawUrl: string, env: HonoEnv['Bindings']): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const allowed = getAllowedOrigins(env).map((o) => {
    try { return new URL(o).origin; } catch { return o; }
  });
  return allowed.includes(parsed.origin);
}

/**
 * 解析前端基址：优先 env.FRONTEND_URL，缺失时仅在非生产环境回退 localhost。
 * 生产环境缺配置返回 null，由调用方决定失败方式，避免静默把用户导向 localhost。
 */
export function resolveFrontendUrl(env: HonoEnv['Bindings']): string | null {
  const configured = (env.FRONTEND_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (env.ENVIRONMENT === 'production') return null;
  return 'http://localhost:5173';
}

export function corsHeaders(origin: string, env: HonoEnv['Bindings']): Headers | null {
  const allowedOrigins = getAllowedOrigins(env);
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : null;
  if (!allowedOrigin) return null;
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  // credentials:include 模式下 CORS 不允许通配符，必须回显具体 origin
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

export function addSecurityHeaders(response: Response, env: HonoEnv['Bindings']): Response {
  const headers = response.headers;
  // 已存在则不覆盖：由内层（如回调的 redirect）设置的更严格策略优先
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'DENY');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // connect-src 纳入 PROD_ORIGINS，避免跨站部署时浏览器拦截前端→Worker 的 fetch
  const prodConnect = (env.PROD_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean).join(' ');
  // 不再放开 'unsafe-eval'：vditor 3.x 不依赖 eval，放开会让 CSP 对动态代码执行形同虚设。
  // 'unsafe-inline' 暂保留（Worker 仅在 dev-login 返回内联脚本 HTML），后续可用 nonce 收敛。
  const csp = env.CONTENT_SECURITY_POLICY
    || `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ${prodConnect} https://api.github.com https://github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', csp);
  return response;
}

export function addCorsHeaders(response: Response, origin: string, env: HonoEnv['Bindings']): Response {
  const cors = corsHeaders(origin, env);
  if (!cors) return response;
  cors.forEach((value, key) => response.headers.set(key, value));
  addSecurityHeaders(response, env);
  return response;
}

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
