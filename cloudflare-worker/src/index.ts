import { Hono } from 'hono';
import type { HonoEnv } from './env';
import { corsMiddleware, resolveFrontendUrl } from './middleware/cors';
import { requestLog } from './middleware/sessionAuth';
import { errorHandler } from './middleware/errorHandler';
import { success } from './comment/utils/response';

import authRoutes from './routes/auth';
import reposRoutes from './routes/repos';
import messagesRoutes from './routes/messages';
import adminRoutes from './routes/admin';
import inboundRoutes from './routes/inbound';
import bufferRoutes from './routes/buffer';

const app = new Hono<HonoEnv>();

// 全局中间件
app.use('*', requestLog);
app.use('*', corsMiddleware);

// 管理面与缓冲层禁缓存：响应被边缘缓存会让匿名请求命中登录态结果
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
    console.error('[health] D1 连接失败：', err);
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
  // 重定向目标只取服务端配置（或非生产环境的 localhost 回退）。
  // 不接受请求头指定目标：那会让任意调用方把用户导向自选地址。
  const frontendUrl = resolveFrontendUrl(c.env);
  if (!frontendUrl) {
    console.error('[index] FRONTEND_URL 未配置，无法重定向非 API 请求');
    return c.json({ error: '服务端未配置前端地址' }, 500);
  }
  return c.redirect(frontendUrl + url.pathname + url.search, 301);
});

export default app;
