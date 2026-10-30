// 公开只读代理的请求解析（零依赖纯函数模块，供 node 原生测试链路直接加载）。
//
// 为什么独立：mediaS3File.ts 依赖 Hono context / aws4fetch，整文件不可在 node
// 测试链路加载。解析逻辑（路径取 key、query 取 backendId）是纯字符串处理，
// 抽出即可单测——与 mediaBackendId.ts 同范式。
//
// 多桶定位约定：用 query ?backendId= 而非路径段 /media-file/<backendId>/<key>。
// 原因：object key 本身含多段（assets/2026/a.webp），路径方案无法区分
// 「backendId=assets, key=2026/a.webp」与「backendId 缺省, key=assets/2026/a.webp」
// 两种意图，解析存在歧义。query 方案与 /api/media/s3/* 的参数风格保持一致。
import { normalizeBackendId } from './mediaBackendId.ts';
import { isSafePathParam } from '../middleware/pathGuard.ts';

/** 公开代理路径前缀 */
export const ROUTE_PREFIX = '/media-file/';

/** 解析结果：要么给出合法的 backendId 与 key，要么给出失败原因 */
export type ParsedMediaFileRequest =
  | { ok: true; backendId: string; key: string }
  | { ok: false; reason: 'invalid-backend-id' | 'invalid-key' };

/**
 * 从请求 URL 解析 backendId 与 object key。
 * @param pathname 请求路径（形如 /media-file/assets/a.webp）
 * @param backendIdParam query 中的 backendId（缺省 → default）
 */
export function parseMediaFileRequest(
  pathname: string,
  backendIdParam?: string | null
): ParsedMediaFileRequest {
  const backendId = normalizeBackendId(backendIdParam ?? undefined);
  if (!backendId) return { ok: false, reason: 'invalid-backend-id' };

  let raw: string;
  try {
    raw = decodeURIComponent(pathname.slice(ROUTE_PREFIX.length));
  } catch {
    return { ok: false, reason: 'invalid-key' };
  }
  const key = raw.replace(/^\/+/, '');
  if (!key || !isSafePathParam(key, true)) return { ok: false, reason: 'invalid-key' };
  return { ok: true, backendId, key };
}
