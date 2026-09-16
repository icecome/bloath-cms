import { Hono } from 'hono';
import type { HonoEnv } from './env';
import { corsMiddleware } from './middleware/cors';
import { requestLog } from './middleware/sessionAuth';
import { errorHandler } from './middleware/errorHandler';
import { success } from './comment/utils/response';

import authRoutes from './routes/auth';
import reposRoutes from './routes/repos';
import messagesRoutes from './routes/messages';
import adminRoutes from './routes/admin';
import inboundRoutes from './routes/inbound';
import bufferRoutes from './routes/buffer';
import { isAllowedFrontendUrl } from './middleware/cors';

const app = new Hono<HonoEnv>();

// 全局中间件
app.use('*', requestLog);
app.use('*', corsMiddleware);

// 管理面与缓冲层禁缓存: 响应被边缘缓存会让匿名请求命中登录态结果
app.use('/admin/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use('/api/admin/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use('/api/buffer/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// 全局错误处理
app.onError(errorHandler);

// 健康检查
app.get('/api/health', async (c) => {
  let d1Connected = false;
  try {
    await c.env.DB.prepare('SELECT 1').first();
    d1Connected = true;
  } catch (err) {
    console.error('[health] D1 连接失败:', err);
  }
  return c.json(success({ status: 'ok', d1: d1Connected ? 'connected' : 'disconnected' }));
});

// 挂载路由
app.route('/', authRoutes);
app.route('/', reposRoutes);
app.route('/', messagesRoutes);
app.route('/', adminRoutes);
app.route('/', inboundRoutes);
app.route('/', bufferRoutes);

// 非 API 请求：重定向到前端
app.all('*', (c) => {
  const url = new URL(c.req.url);
  const headerFrontendUrl = c.req.header('X-Frontend-Url');
  const frontendUrl = (headerFrontendUrl && isAllowedFrontendUrl(headerFrontendUrl, c.env))
    ? headerFrontendUrl
    : (c.env.FRONTEND_URL || 'http://localhost:5173');
  return c.redirect(frontendUrl + url.pathname + url.search, 301);
});

export default app;
