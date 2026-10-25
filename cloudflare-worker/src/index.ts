import { Hono } from 'hono';
import type { HonoEnv } from './env';
import { corsMiddleware, resolveFrontendUrl } from './middleware/cors';
import { requestLog } from './middleware/sessionAuth';
import { errorHandler } from './middleware/errorHandler';
import { success } from './lib/response';

import authRoutes from './routes/auth';
import reposRoutes from './routes/repos';
import bufferRoutes from './routes/buffer';
import mediaS3Routes from './routes/mediaS3';

const app = new Hono<HonoEnv>();

// 登录白名单 + 密钥强度的惰性启动校验：生产环境未配置 ADMIN_GITHUB_LOGIN 时，
// 除健康检查外全部拒绝，避免「忘了配白名单」在静默放行状态下运行数月。
// SESSION_SECRET < 32 字符同样 fail-closed：它派生所有加密密钥（会话/S3 配置/
// OAuth state），熵不足等于整个加密面裸奔（audit P2-31）。
// （Workers 无常驻启动钩子，模块加载期读不到 wrangler 绑定，故用请求时惰性校验。）
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next();
  if (c.env.ENVIRONMENT === 'production') {
    if (!((c.env.ADMIN_GITHUB_LOGIN || '').trim())) {
      return c.json({ error: '服务端未配置登录白名单（ADMIN_GITHUB_LOGIN），已 fail-closed' }, 503);
    }
    if ((c.env.SESSION_SECRET || '').length < 32) {
      return c.json({ error: 'SESSION_SECRET 强度不足（≥32 字符随机串），已 fail-closed' }, 503);
    }
  }
  await next();
});

// 全局中间件
app.use('*', requestLog);
app.use('*', corsMiddleware);

// 管理面与缓冲层禁缓存：响应被边缘缓存会让匿名请求命中登录态结果
app.use('/api/buffer/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use('/api/media/s3/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// 全局错误处理
app.onError(errorHandler);

// 写端点限流（audit P2-27）在各路由文件内部挂载、紧跟 requireAuth 之后：
// key 依赖 c.get('auth')（githubLogin），而本文件的 app.use('/api/repos/*', ...)
// 注册在 route('/') 挂载之前，会先于路由级 requireAuth 执行——auth 恒为空、
// 限流键恒为空串、全部请求被放行，等于没有限流（audit 本轮 M-S1）。
// 迁移后 requireAuth 先写入 auth，限流器才能拿到稳定的账号维度键。

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
app.route('/', bufferRoutes);
app.route('/', mediaS3Routes);

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
