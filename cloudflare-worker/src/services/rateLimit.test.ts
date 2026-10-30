// 限流 429 响应格式回归测试（mediaS3File 直链路由返回 JSON 的故障修复）。
//
// 为什么放 services/：CI 的 worker 测试步只跑 `src/services/*.test.ts`
// （AGENTS.md §9 坑位 1），本测试锁的是 middleware/rateLimit.ts 的响应契约，
// 只有放在这里才会被执行。测试只验证「响应格式」这一行为，不含业务逻辑。
//
// 运行：node --experimental-strip-types --test src/services/rateLimit.test.ts
// 导入必须显式带 `.ts` 后缀：node ESM 下无后缀的相对导入会 ERR_MODULE_NOT_FOUND
// （AGENTS.md §9 关于 sortFiles.ts 的事故记录）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { rateLimit } from '../middleware/rateLimit.ts';

/** 顶到上限的假 KV：任何请求都触发限流 */
function fullWindowKv(expiresInMs = 30_000) {
  return {
    get: async () => JSON.stringify({ count: 600, expiresAt: Date.now() + expiresInMs }),
    put: async () => undefined,
  } as any;
}

/** 空窗口的假 KV：计数从 0 开始，请求应放行 */
function emptyWindowKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
  } as any;
}

const IP = { 'x-test-ip': '203.0.113.7' };

function buildApp(kv: any) {
  const app = new Hono<any>();
  const key = (c: any) => `r:${c.req.header('x-test-ip') || ''}`;

  // API 形态：默认 JSON 信封（writeLimit / repos / buffer 走这条）
  app.use('/api/*', rateLimit({ key, limit: 10, windowMs: 60_000 }));
  app.get('/api/x', (c: any) => c.text('ok'));

  // 媒体直链形态：纯文本 429（routes/mediaS3File.ts 的 onLimit）
  app.use('/media-file/*', rateLimit({
    key,
    limit: 600,
    windowMs: 60_000,
    onLimit: (c: any, info: any) => c.text(`429 Too Many Requests (retry after ${info.retryAfterSec}s)`, 429),
  }));
  app.get('/media-file/*', (c: any) => c.text('binary'));

  return { app, env: { DEVICES_KV: kv } };
}

async function hit(app: any, env: any, path: string) {
  const res = await app.fetch(new Request(`http://w${path}`, { headers: IP }), env);
  return { status: res.status, type: res.headers.get('content-type'), retry: res.headers.get('retry-after'), body: await res.text() };
}

describe('rateLimit 默认 JSON 信封（API 路由）', () => {
  it('超限时返回 429 + application/json，并带 Retry-After', async () => {
    const { app, env } = buildApp(fullWindowKv());
    const r = await hit(app, env, '/api/x');
    assert.equal(r.status, 429);
    assert.match(r.type ?? '', /application\/json/);
    assert.equal(r.retry, '30');
    assert.deepEqual(Object.keys(JSON.parse(r.body)), ['error']);
    assert.match(JSON.parse(r.body).error, /请求过于频繁/);
  });
});

describe('rateLimit onLimit 自定义格式（媒体直链路由）', () => {
  it('超限时返回 429 纯文本，不含 JSON 信封', async () => {
    const { app, env } = buildApp(fullWindowKv());
    const r = await hit(app, env, '/media-file/a.jpg');
    assert.equal(r.status, 429);
    assert.match(r.type ?? '', /^text\/plain/);
    assert.doesNotMatch(r.body, /^\{/);
    assert.equal(r.body, '429 Too Many Requests (retry after 30s)');
  });

  it('Retry-After 在自定义格式下同样被合并进响应头（走 c.header 暂存 + c.text 产出）', async () => {
    const { app, env } = buildApp(fullWindowKv(8_000));
    const r = await hit(app, env, '/media-file/a.jpg');
    // 8s 向上取整为 8，且必须 ≥1
    assert.ok(Number(r.retry) >= 1 && Number(r.retry) <= 8, `retry-after=${r.retry}`);
  });

  it('未超限时正常放行，不产生 429、不改动媒体响应体', async () => {
    const { app, env } = buildApp(emptyWindowKv());
    const r = await hit(app, env, '/media-file/a.jpg');
    assert.equal(r.status, 200);
    assert.equal(r.body, 'binary');
    assert.equal(r.retry, null);
  });
});

describe('限流跳过的两个入口（回归锁）', () => {
  it('无 KV 绑定时放行（本地 dev）', async () => {
    const app = new Hono<any>();
    app.use('/media-file/*', rateLimit({ key: (c: any) => `r:${c.req.header('x-test-ip') || ''}`, limit: 1, windowMs: 60_000, onLimit: (c: any) => c.text('429 Too Many Requests', 429) }));
    app.get('/media-file/*', (c: any) => c.text('binary'));
    const res = await app.fetch(new Request('http://w/media-file/a.jpg', { headers: IP }), {});
    assert.equal(res.status, 200);
  });

  it('key 为空串时放行（限流键取不到值不误伤）', async () => {
    const app = new Hono<any>();
    app.use('/api/*', rateLimit({ key: () => '', limit: 1, windowMs: 60_000 }));
    app.get('/api/x', (c: any) => c.text('ok'));
    const res = await app.fetch(new Request('http://w/api/x', { headers: IP }), { DEVICES_KV: fullWindowKv() });
    assert.equal(res.status, 200);
  });

  it('cf-connecting-ip 缺失时键退化为 `r:`，仍受限流约束（不静默失守）', async () => {
    const { app, env } = buildApp(fullWindowKv());
    const res = await app.fetch(new Request('http://w/api/x'), env);
    assert.equal(res.status, 429);
  });
});
