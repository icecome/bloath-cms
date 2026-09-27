// 缓冲层业务：文件读写、变更清单、key 构造
import type { Env } from '../env';
import type { BufferConfig } from './bufferConfig.service';
import { getBufferConfig } from './bufferConfig.service';
import { putObject, getObject, deleteObject, listObjects } from './s3.client';
import { readFile } from './github';
import { mapLimit } from '../lib/concurrency';

export type BufferOp = 'write' | 'delete' | 'move';

export interface BufferEntry {
  op: BufferOp;
  content?: string;
  fromPath?: string;
  baseSha?: string;
  savedAt: number;
  /** 发布目标目录（如 content/posts/sub）；缺省表示发布时落回草稿目录 */
  publishTarget?: string;
}

export interface BufferChangeItem {
  path: string;
  op: BufferOp;
  fromPath?: string;
  savedAt: number;
  publishTarget?: string;
}

export class BufferUnavailableError extends Error {
  constructor(message = '缓冲层未配置或不可用') {
    super(message);
    this.name = 'BufferUnavailableError';
  }
}

export async function requireBufferConfig(env: Env): Promise<BufferConfig> {
  const cfg = await getBufferConfig(env);
  if (!cfg) throw new BufferUnavailableError();
  return cfg;
}

// key: {prefix}/{rand}/{owner}/{repo}/{branch}/{path}.buf
export function bufferKey(cfg: BufferConfig, owner: string, repo: string, branch: string, path: string): string {
  return `${cfg.prefix}/${cfg.rand}/${owner}/${repo}/${branch}/${path}.buf`;
}

export function repoPrefix(cfg: BufferConfig, owner: string, repo: string, branch: string): string {
  return `${cfg.prefix}/${cfg.rand}/${owner}/${repo}/${branch}/`;
}

// 从 key 反解出文件路径
export function pathFromKey(prefix: string, key: string): string | null {
  if (!key.startsWith(prefix) || !key.endsWith('.buf')) return null;
  return key.slice(prefix.length, key.length - '.buf'.length);
}

const S3_CONCURRENCY = 20;

export async function writeBufferEntry(
  env: Env, owner: string, repo: string, branch: string, path: string, entry: BufferEntry
): Promise<void> {
  const cfg = await requireBufferConfig(env);
  await putObject(cfg, bufferKey(cfg, owner, repo, branch, path), JSON.stringify(entry));
}

export async function readBufferEntry(
  env: Env, owner: string, repo: string, branch: string, path: string
): Promise<BufferEntry | null> {
  const cfg = await requireBufferConfig(env);
  const raw = await getObject(cfg, bufferKey(cfg, owner, repo, branch, path));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as BufferEntry;
  } catch {
    return null;
  }
}

export async function deleteBufferEntry(
  env: Env, owner: string, repo: string, branch: string, path: string
): Promise<void> {
  const cfg = await requireBufferConfig(env);
  await deleteObject(cfg, bufferKey(cfg, owner, repo, branch, path));
}

// 仅更新发布目标，保留内容与操作类型；条目不存在时返回 false
export async function setBufferPublishTarget(
  env: Env, owner: string, repo: string, branch: string, path: string, publishTarget: string | null
): Promise<boolean> {
  const existing = await readBufferEntry(env, owner, repo, branch, path);
  if (!existing) return false;
  const next: BufferEntry = { ...existing, savedAt: Date.now() };
  if (publishTarget) {
    next.publishTarget = publishTarget;
  } else {
    delete next.publishTarget;
  }
  await writeBufferEntry(env, owner, repo, branch, path, next);
  return true;
}

// 变更清单（永久保留，不做时间过期清理）
export async function listBufferChanges(
  env: Env, owner: string, repo: string, branch: string
): Promise<BufferChangeItem[]> {
  const cfg = await requireBufferConfig(env);
  const prefix = repoPrefix(cfg, owner, repo, branch);
  const entries = await listObjects(cfg, prefix);

  const parsed = await mapLimit(entries, S3_CONCURRENCY, async (e): Promise<BufferChangeItem | null> => {
    const path = pathFromKey(prefix, e.key);
    if (!path) return null;
    try {
      const raw = await getObject(cfg, e.key);
      if (raw === null) return null;
      const entry = JSON.parse(raw) as BufferEntry;
      return {
        path, op: entry.op, fromPath: entry.fromPath,
        savedAt: entry.savedAt || 0, publishTarget: entry.publishTarget,
      };
    } catch {
      return null;
    }
  });

  const items = parsed.filter((x): x is BufferChangeItem => x !== null);
  items.sort((a, b) => b.savedAt - a.savedAt);
  return items;
}

// 读取缓冲全文（发布编排用）
export async function readBufferFull(
  env: Env, owner: string, repo: string, branch: string
): Promise<Array<{ path: string; entry: BufferEntry; key: string }>> {
  const cfg = await requireBufferConfig(env);
  const prefix = repoPrefix(cfg, owner, repo, branch);
  const entries = await listObjects(cfg, prefix);

  const results = await mapLimit(entries, S3_CONCURRENCY, async (e) => {
    const path = pathFromKey(prefix, e.key);
    if (!path) return null;
    try {
      const raw = await getObject(cfg, e.key);
      if (raw === null) return null;
      return { path, entry: JSON.parse(raw) as BufferEntry, key: e.key };
    } catch {
      return null;
    }
  });

  return results.filter((x): x is { path: string; entry: BufferEntry; key: string } => x !== null);
}

export interface CleanupResult {
  cleared: number;
  failed: number;
}

export async function cleanupBufferKeys(env: Env, keys: string[]): Promise<CleanupResult> {
  const cfg = await requireBufferConfig(env);
  let cleared = 0;
  let failed = 0;
  await mapLimit(keys, S3_CONCURRENCY, async (key) => {
    try {
      await deleteObject(cfg, key);
      cleared++;
    } catch (err) {
      failed++;
      console.error('[buffer] 清理失败:', key, err);
    }
  });
  return { cleared, failed };
}

// 编辑器读取：缓冲优先，miss 回退 GitHub
export async function readFileWithBuffer(
  env: Env, githubToken: string,
  owner: string, repo: string, branch: string, path: string
): Promise<{ content: string; sha: string; source: 'buffer' | 'github' }> {
  let buffered: BufferEntry | null = null;
  try {
    buffered = await readBufferEntry(env, owner, repo, branch, path);
  } catch (err) {
    console.warn('[buffer] 读取缓冲失败，回退 GitHub:', err);
  }
  if (buffered && buffered.op === 'write' && typeof buffered.content === 'string') {
    return { content: buffered.content, sha: '', source: 'buffer' };
  }
  // delete/move 墓碑或缓冲 miss：读 GitHub
  const file = await readFile(githubToken, owner, repo, path, branch);
  return { content: file.content, sha: file.sha, source: 'github' };
}
