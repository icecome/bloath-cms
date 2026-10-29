// 公开只读文件代理：GET /media-file/<key>
//
// 作用：让「公网访问基址」指向本 Worker（如 https://<worker域名>/media-file/{path}）
// 时，浏览器无需任何凭据即可读到桶内对象。典型场景：S3 服务商不提供匿名公网
// 外链/自定义域名（如学术云 CSTCloud），或希望桶保持私有——读取全部经 Worker
// 以服务端凭据 SigV4 签名完成，桶无需开放公有读。
//
// 设计要点：
// · 公开无鉴权（博客媒体本就公网可读），但仅 GET/HEAD + key 白名单校验 + 按 IP 限流；
// · Worker 侧配置了 prefix 时只放行前缀内的 key，避免把整桶暴露到公网；
// · 200 且无 Range 的响应写入边缘 Cache API：对象 key 每次上传唯一（含时间戳+随机
//   后缀），可 immutable 长缓存；命中后不回源，省服务商出网流量。Range/HEAD/非 200
//   直接透传不缓存（Cache API 只能存 200 完整响应）；
// · 未配置凭据/对象不存在一律 404，不泄露桶内结构差异。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { rateLimit } from '../middleware/rateLimit';
import { isSafePathParam } from '../middleware/pathGuard';
import { getMediaS3Config } from '../services/mediaS3Config.service';
import { fetchObjectResponse } from '../services/s3.client';

const mediaS3FileApp = new Hono<HonoEnv>();

const ROUTE_PREFIX = '/media-file/';
/** 每分钟每 IP 的读取上限：正常博客页几十张图 + 边缘命中都在此之下，仅作滥用护栏 */
const RATE_LIMIT = { limit: 600, windowMs: 60_000 };
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/** Workers Cache API；本地 node 测试链路无 caches 全局，降级为不缓存 */
function edgeCache(): Cache | null {
  return typeof caches !== 'undefined' ? caches.default : null;
}

/** 从请求路径解出对象 key：百分号解码 + 白名单校验（拒绝 ..、\0 与非法字符） */
function keyFromRequest(c: Context<HonoEnv>): string | null {
  let raw: string;
  try {
    raw = decodeURIComponent(new URL(c.req.url).pathname.slice(ROUTE_PREFIX.length));
  } catch {
    return null;
  }
  const key = raw.replace(/^\/+/, '');
  if (!key || !isSafePathParam(key, true)) return null;
  return key;
}

async function handle(c: Context<HonoEnv>): Promise<Response> {
  const key = keyFromRequest(c);
  if (!key) return c.text('invalid key', 400);

  const cfg = await getMediaS3Config(c.env);
  if (!cfg) return c.text('object storage not configured', 404);
  // prefix 是媒体库的上传根目录：限定只服务前缀内对象，其余桶内容不经此暴露
  if (cfg.prefix && !key.startsWith(`${cfg.prefix}/`)) return c.text('not found', 404);

  const range = c.req.header('range') || undefined;
  const isHead = c.req.method === 'HEAD';
  const cache = edgeCache();
  const cacheable = !isHead && !range;

  if (cache && cacheable) {
    const hit = await cache.match(c.req.url).catch(() => undefined);
    if (hit) return hit;
  }

  let s3res: Response;
  try {
    s3res = await fetchObjectResponse(cfg, key, range);
  } catch (err) {
    console.error('[mediaS3File] 回源失败:', err);
    return c.text('upstream error', 502);
  }

  if (s3res.status === 404 || s3res.status === 403) {
    // 403（私有桶且签名未生效等）对外同样按不存在处理，避免暴露权限差异
    return c.text('not found', 404);
  }
  if (!s3res.ok) {
    console.error(`[mediaS3File] GET ${key} -> ${s3res.status}`);
    return c.text('upstream error', 502);
  }

  // 只透传内容相关头；x-amz-*/server 等上游元数据不外泄
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'etag', 'accept-ranges', 'content-range', 'last-modified']) {
    const v = s3res.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('cache-control', IMMUTABLE_CACHE);

  const res = new Response(isHead ? null : s3res.body, { status: s3res.status, headers });

  // 边缘缓存仅在「完整 200 无 Range」时进行；waitUntil 不阻塞响应
  if (cache && s3res.status === 200 && cacheable) {
    try {
      const clone = res.clone();
      c.executionCtx.waitUntil(cache.put(c.req.url, clone).catch(() => {}));
    } catch {
      // executionCtx 在非 Workers 运行环境不可用：跳过缓存
    }
  }
  return res;
}

mediaS3FileApp.use(`${ROUTE_PREFIX}*`, rateLimit({
  key: (c) => `r:${c.req.header('cf-connecting-ip') || ''}`,
  ...RATE_LIMIT,
}));

mediaS3FileApp.get(`${ROUTE_PREFIX}*`, handle);
mediaS3FileApp.on('HEAD', `${ROUTE_PREFIX}*`, handle);

export default mediaS3FileApp;
