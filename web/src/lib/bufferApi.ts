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
  publishTarget?: string;
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
  op: BufferOp; content?: string; fromPath?: string; baseSha?: string; publishTarget?: string;
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

/** 设置/清除单条缓冲发布目标；publishTarget 为 null 表示清除 */
export function setBufferPublishTarget(params: {
  owner: string; repo: string; branch: string; path: string; publishTarget: string | null;
}): Promise<{ path: string; publishTarget: string | null }> {
  return bufferFetch<{ path: string; publishTarget: string | null }>('/api/buffer/target', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function getBufferChanges(params: { owner: string; repo: string; branch: string }): Promise<BufferChangesResult> {
  const q = new URLSearchParams(params);
  return bufferFetch<BufferChangesResult>(`/api/buffer/changes?${q.toString()}`);
}

// ---------- 发布 ----------

export interface PublishItem {
  path: string;
  publishTarget?: string;
}

// items 省略 = 全量发布；提供则逐项发布
export function publishBuffer(params: {
  owner: string; repo: string; branch: string; userName?: string; items?: PublishItem[];
}): Promise<PublishResult> {
  return bufferFetch('/api/buffer/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }, PUBLISH_TIMEOUT_MS);
}
