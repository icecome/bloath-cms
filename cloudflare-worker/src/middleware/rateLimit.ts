// 全局限流中间件（audit P2-27）：留言模块下线时 rate_limits 表一并删除，
// 写端点自此无任何节流。本实现用 DEVICES_KV 固定窗口计数（免建 DO/表）。
//
// 已知取舍（单用户产品可接受）：
// - KV 最终一致：窗口内计数可能略低于真实值——限流是防滥用护栏，非精确计费；
// - 每请求 1 次 KV 读 + 命中时 1 次写：免费版 KV 每日 10 万写，单博主用不完。
//
// 响应格式：默认 JSON 错误信封（面向 /api/* 的管理端点，前端按 status 判断、
// 可选读 body）。直链媒体代理这类「响应体会被浏览器当资源渲染」的路由不能用
// JSON，通过 onLimit 换成纯文本（见 routes/mediaS3File.ts）。
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { HonoEnv } from '../env';

/** 触发限流时传给 onLimit 的上下文，格式无关 */
export interface RateLimitInfo {
  /** 距窗口结束的等待秒数（≥1），中间件已写入 Retry-After 头 */
  retryAfterSec: number;
  /** 窗口内最大请求数 */
  limit: number;
  /** 窗口长度毫秒 */
  windowMs: number;
}

export interface RateLimitOptions {
  /** 限流键（如 `w:{githubLogin}`）；返回空串则跳过限流 */
  key: (c: Context<HonoEnv>) => string;
  /** 窗口内最大请求数 */
  limit: number;
  /** 窗口长度毫秒 */
  windowMs: number;
  /**
   * 限流命中时的响应构造器。必须用 `c.text()` / `c.json()` 之类 Context 方法
   * 产出响应，不要用裸 `new Response()`：Retry-After 通过 c.header() 暂存在
   * Context 上，只有走 Context 工厂才会被合并进最终响应头。
   */
  onLimit?: (c: Context<HonoEnv>, info: RateLimitInfo) => Response | Promise<Response>;
}

interface WindowCounter {
  count: number;
  expiresAt: number;
}

/** 默认格式：API JSON 信封 */
function jsonLimitResponse(c: Context<HonoEnv>, info: RateLimitInfo): Response {
  return c.json(
    { error: `请求过于频繁（每 ${Math.round(info.windowMs / 1000)}s 限 ${info.limit} 次），请稍后再试` },
    429
  );
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<HonoEnv> {
  const onLimit = opts.onLimit ?? jsonLimitResponse;
  return async (c: Context<HonoEnv>, next: Next) => {
    const key = opts.key(c);
    const kv = c.env.DEVICES_KV;
    if (!key || !kv) {
      // 无 KV 绑定（本地 dev）或键为空：放行，不打断主流程
      await next();
      return;
    }
    const windowStart = Math.floor(Date.now() / opts.windowMs) * opts.windowMs;
    const rlKey = `rl:${windowStart}:${key}`;
    let counter: WindowCounter = { count: 0, expiresAt: windowStart + opts.windowMs };
    try {
      const raw = await kv.get(rlKey);
      if (raw) {
        const parsed = JSON.parse(raw) as WindowCounter;
        if (typeof parsed.count === 'number') counter = parsed;
      }
    } catch {
      // 读失败视为新窗口：宁可放行也不因限流器故障拒服务
    }

    if (counter.count >= opts.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((counter.expiresAt - Date.now()) / 1000));
      // 先暂存 Retry-After，再由 onLimit 产出响应（两种格式都带这个头）
      c.header('Retry-After', String(retryAfterSec));
      return onLimit(c, { retryAfterSec, limit: opts.limit, windowMs: opts.windowMs });
    }

    counter.count += 1;
    // 写失败静默：限流器自身的可用性优先于计数精度
    await kv.put(rlKey, JSON.stringify(counter), {
      expirationTtl: Math.max(60, Math.ceil(opts.windowMs / 1000)),
    }).catch(() => undefined);

    await next();
  };
}
