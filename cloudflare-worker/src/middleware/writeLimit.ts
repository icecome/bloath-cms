// 写端点限流（audit P2-27）：按登录账号 + 方法族分桶。
// 缓冲/仓库写 30/min：单博主正常写作节奏（保存/上传/发布）远低于此阈值；
// GET 不限（读多写少，且 GitHub 侧自身有次级限流）。
//
// 必须挂在 requireAuth 之后（各路由文件内部，而非 index.ts 全局层）：
// key 读 c.get('auth').githubLogin，requireAuth 先执行才会写入该值。
// 放在全局层会先于路由级 auth 执行，key 恒为空串、全部请求被放行（audit 本轮 M-S1）。
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../env';
import { rateLimit } from '../middleware/rateLimit';

const writeLimit = rateLimit({
  key: (c) => {
    const auth = c.get('auth') as { githubLogin?: string } | undefined;
    return auth?.githubLogin ? `w:${auth.githubLogin.toLowerCase()}` : '';
  },
  limit: 30,
  windowMs: 60_000,
});

/** POST/PUT/DELETE 走 30/min 账号级限流，其余方法直通 */
export const writeLimitAfterAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(c.req.method)) return next();
  return writeLimit(c, next);
};
