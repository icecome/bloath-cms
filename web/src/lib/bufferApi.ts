// 缓冲层 API 客户端（基于共享 requestJson）
import { API_BASE } from './constants';
import { requestJson } from './http';

const API_TIMEOUT_MS = 15000;
const PUBLISH_TIMEOUT_MS = 30000;

function bufferFetch<T>(url: string, options?: RequestInit, timeoutMs = API_TIMEOUT_MS): Promise<T> {
  return requestJson<T>(url, { ...options, timeoutMs }, API_BASE);
}

// ---------- 类型 ----------

export interface BufferConfigPublic {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKeyMasked: string;
  prefix: string;
  rand: string;
}

export interface BufferConfigInput {
  enabled: boolean;
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
}

export type BufferOp = 'write' | 'delete' | 'move';

export interface BufferChangeItem {
  path: string;
  op: BufferOp;
  fromPath?: string;
  savedAt: number;
}

export interface BufferChangesResult {
  items: BufferChangeItem[];
  count: number;
}

export interface FileWithBuffer {
  content: string;
  sha: string;
  source: 'buffer' | 'github';
}

export interface PublishResult {
  commitSha: string | null;
  published: number;
  skipped: number;
  bufferCleared: number;
  cleanupFailed?: number;
  message: string;
}

// ---------- 配置 ----------

export function getBufferConfig(): Promise<BufferConfigPublic | null> {
  return bufferFetch<BufferConfigPublic | null>('/api/buffer/config');
}

export function saveBufferConfig(input: BufferConfigInput): Promise<BufferConfigPublic | null> {
  return bufferFetch('/api/buffer/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function testBufferConfig(input: Partial<BufferConfigInput>): Promise<{ ok: boolean }> {
  return bufferFetch('/api/buffer/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// ---------- 缓冲读写 ----------

export function readBufferFile(params: { owner: string; repo: string; branch: string; path: string }): Promise<FileWithBuffer> {
  const q = new URLSearchParams(params);
  return bufferFetch<FileWithBuffer>(`/api/buffer/file?${q.toString()}`);
}

export function writeBufferFile(params: {
  owner: string; repo: string; branch: string; path: string;
  op: BufferOp; content?: string; fromPath?: string; baseSha?: string;
}): Promise<null> {
  return bufferFetch('/api/buffer/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function discardBufferFile(params: { owner: string; repo: string; branch: string; path: string }): Promise<null> {
  const q = new URLSearchParams(params);
  return bufferFetch(`/api/buffer/file?${q.toString()}`, { method: 'DELETE' });
}

export function getBufferChanges(params: { owner: string; repo: string; branch: string }): Promise<BufferChangesResult> {
  const q = new URLSearchParams(params);
  return bufferFetch<BufferChangesResult>(`/api/buffer/changes?${q.toString()}`);
}

// ---------- 发布 ----------

export function publishBuffer(params: { owner: string; repo: string; branch: string; userName?: string }): Promise<PublishResult> {
  return bufferFetch('/api/buffer/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }, PUBLISH_TIMEOUT_MS);
}

// 草稿箱直发布后同步清理对应缓冲
export function discardBufferPaths(params: { owner: string; repo: string; branch: string; paths: string[] }): Promise<null> {
  return bufferFetch('/api/buffer/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}
