// 媒体图床 S3 代理客户端（P1-001）：浏览器不持有凭据，全部操作经 Worker 代理。
// 旧实现（aws4fetch 浏览器直连 + localStorage 明文凭据）已删除。

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

export async function getMediaS3Config(): Promise<MediaS3ConfigPublic | null> {
  return mediaS3Fetch<MediaS3ConfigPublic | null>('/config');
}

export async function saveMediaS3Config(input: MediaS3ConfigInput): Promise<MediaS3ConfigPublic | null> {
  return mediaS3Fetch<MediaS3ConfigPublic | null>('/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteMediaS3Config(): Promise<void> {
  await mediaS3Fetch('/config', { method: 'DELETE' }, { skipDataCheck: true });
}

export async function testMediaS3Config(input: Partial<MediaS3ConfigInput>): Promise<{ ok: boolean }> {
  return mediaS3Fetch<{ ok: boolean }>('/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function listMediaS3Objects(prefix: string): Promise<MediaS3Object[]> {
  const q = new URLSearchParams({ prefix });
  return mediaS3Fetch<MediaS3Object[]>(`/objects?${q.toString()}`);
}

/** 上传二进制；blob 经 Worker 代理写入（凭据不出服务端） */
export async function putMediaS3Object(key: string, blob: Blob | ArrayBuffer, contentType?: string): Promise<void> {
  const q = new URLSearchParams({ key });
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

export async function deleteMediaS3Object(key: string): Promise<void> {
  const q = new URLSearchParams({ key });
  await mediaS3Fetch(`/objects?${q.toString()}`, { method: 'DELETE' }, { skipDataCheck: true });
}
