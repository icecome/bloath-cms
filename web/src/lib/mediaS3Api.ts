// 媒体图床 S3 代理客户端（P1-001 重写；并行多桶扩展）：
// 旧实现 aws4fetch 浏览器直连 + localStorage 明文凭据已删除——凭据现仅存
// Worker 侧加密存储（cloudflare-worker/src/services/mediaS3Config.service），
// 上传/列举/删除经 /api/media/s3/* 代理执行，secret 永不回传浏览器。
//
// 并行多桶：所有操作可携带 backendId（缺省 = 'default'），Worker 按分键
// `media_s3_config:<id>` 加载对应桶配置。页面层在操作多桶后端时传入目标 id。

import { requestJson } from './http.ts';

// 不能导入 constants.ts：它读取 import.meta.env（Vite 专属）且内部导入无扩展名，
// 会阻断 node --experimental-strip-types 测试链路（见 undoConstants.ts 头注释）。
// 这里以 node 安全的可选链读取同一变量，语义与 constants.API_BASE 完全一致：
// 生产指向 Worker 域名，本地开发为空串走 Vite 代理。
const API_BASE: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL ?? '';

/** 列举条目（与 Worker listObjects 返回结构一致） */
export interface MediaS3Object {
  key: string;
  size: number;
  lastModified: string;
}

export interface MediaS3ConfigPublic {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyIdMasked: string;
  prefix: string;
  configured: boolean;
}

export interface MediaS3ConfigInput {
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  /** 留空表示沿用已存密钥 */
  secretAccessKey: string;
  prefix?: string;
}

function mediaS3Fetch<T>(path: string, init?: RequestInit, opts?: { skipDataCheck?: boolean; timeoutMs?: number }): Promise<T> {
  // 第三参 baseUrl 必须显式传 API_BASE（同 bufferApi）：生产环境 VITE_API_URL 指向
  // Worker 域名，漏传会让请求落在 Pages 静态站自己身上（POST 会被 405 拒绝）。
  // 本地开发 API_BASE 为空串，仍走 Vite 代理，行为不变。
  return requestJson<T>(`/api/media/s3${path}`, {
    credentials: 'include',
    ...init,
    skipDataCheck: opts?.skipDataCheck,
    timeoutMs: opts?.timeoutMs,
    // timeoutMs 属 requestJson 自身的 options（非 RequestInit），已在外层展开
  } as RequestInit & { skipDataCheck?: boolean; timeoutMs?: number }, API_BASE);
}

/**
 * query 串附加 backendId：只要传入就追加（含 'default'），仅 undefined 时省略。
 * 显式优于隐式——即使与 Worker 缺省行为等价，显式传参也让请求意图清晰可审计。
 */
function withBackendId(q: URLSearchParams, backendId?: string): URLSearchParams {
  if (backendId !== undefined) q.set('backendId', backendId);
  return q;
}

export async function getMediaS3Config(backendId?: string): Promise<MediaS3ConfigPublic | null> {
  const q = withBackendId(new URLSearchParams(), backendId);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return mediaS3Fetch<MediaS3ConfigPublic | null>(`/config${suffix}`);
}

export async function saveMediaS3Config(input: MediaS3ConfigInput, backendId?: string): Promise<MediaS3ConfigPublic | null> {
  const q = withBackendId(new URLSearchParams(), backendId);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return mediaS3Fetch<MediaS3ConfigPublic | null>(`/config${suffix}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteMediaS3Config(backendId?: string): Promise<void> {
  const q = withBackendId(new URLSearchParams(), backendId);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  await mediaS3Fetch(`/config${suffix}`, { method: 'DELETE' }, { skipDataCheck: true });
}

export async function testMediaS3Config(input: Partial<MediaS3ConfigInput>, backendId?: string): Promise<{ ok: boolean }> {
  const q = withBackendId(new URLSearchParams(), backendId);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return mediaS3Fetch<{ ok: boolean }>(`/config/test${suffix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function listMediaS3Objects(prefix: string, backendId?: string): Promise<MediaS3Object[]> {
  const q = withBackendId(new URLSearchParams({ prefix }), backendId);
  return mediaS3Fetch<MediaS3Object[]>(`/objects?${q.toString()}`);
}

/** 上传二进制；blob 经 Worker 代理写入（凭据不出服务端） */
export async function putMediaS3Object(key: string, blob: Blob | ArrayBuffer, contentType?: string, backendId?: string): Promise<void> {
  const q = withBackendId(new URLSearchParams({ key }), backendId);
  if (contentType) q.set('contentType', contentType);
  const size = 'size' in blob ? blob.size : 0;
  await mediaS3Fetch(`/objects?${q.toString()}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: blob,
  }, {
    skipDataCheck: true,
    // 大文件上传需要更宽松的超时（同 uploadMediaBinary 的线性放大语义）
    timeoutMs: Math.min(30_000 + (size / (1024 * 1024)) * 2_000, 600_000),
  });
}

export async function deleteMediaS3Object(key: string, backendId?: string): Promise<void> {
  const q = withBackendId(new URLSearchParams({ key }), backendId);
  await mediaS3Fetch(`/objects?${q.toString()}`, { method: 'DELETE' }, { skipDataCheck: true });
}
