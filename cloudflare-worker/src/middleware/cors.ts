// CORS / CSP / 安全响应头
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../env';

export function getAllowedOrigins(env: HonoEnv['Bindings']): string[] {
  const customOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  const corsOrigin = (env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  const defaultOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:5173'];
  const prodOrigins = env.PROD_ORIGINS ? env.PROD_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : [];
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
  // credentials:include 模式下 CORS 不允许通配符，必须回显具体 origin
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

export function addSecurityHeaders(response: Response, env: HonoEnv['Bindings']): Response {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // connect-src 纳入 PROD_ORIGINS，避免跨站部署时浏览器拦截前端→Worker 的 fetch
  const prodConnect = (env.PROD_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean).join(' ');
  const csp = env.CONTENT_SECURITY_POLICY
    || `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ${prodConnect} https://api.github.com https://github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
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
