import type { Repo, RepoInfo, CommitOp } from '../../../shared/types';
import { API_BASE, MAX_TREE_ITEMS } from './constants';
import { requestJson, type HttpRequestOptions } from './http.ts';

export type { CommitOp };

export interface ContentItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
  frontmatter?: {
    title?: string;
    date?: string;
    tags?: string[];
  };
}

const API_TIMEOUT_MS = 10000;

export function formatTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}`;
}

/**
 * 本模块的统一请求入口。
 * 超时 / 401 事件 / 503 / 204 / 双信封解析 / 结构化错误码统一由 requestJson 提供，
 * 此处只负责补上默认超时与 skipDataCheck 的语义透传。
 */
async function apiFetch<T>(url: string, options?: HttpRequestOptions, skipDataCheck = false): Promise<T> {
  const { timeoutMs = API_TIMEOUT_MS, ...rest } = options ?? {};
  return requestJson<T>(url, { ...rest, timeoutMs, skipDataCheck });
}

interface FileReadResult {
  content: string;
  sha: string;
}

interface WriteResult {
  path: string;
}

interface TreeItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
  lastModified?: number;
}

export async function getRepos(): Promise<Repo[]> {
  return apiFetch<Repo[]>(`${API_BASE}/api/repos`);
}

export async function getFiles(params: RepoInfo & { path?: string }): Promise<ContentItem[]> {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    path: params.path || '',
    branch: params.branch || 'main'
  });

  return apiFetch<ContentItem[]>(`${API_BASE}/api/repos/files?${searchParams}`);
}

export async function readFile(params: RepoInfo & { path: string }, timeoutMs?: number): Promise<FileReadResult> {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    branch: params.branch || 'main'
  });

  return apiFetch<FileReadResult>(`${API_BASE}/api/repos/file?${searchParams}`, {
    timeoutMs: timeoutMs ?? API_TIMEOUT_MS,
  });
}

export async function writeFile(
  params: RepoInfo & { path: string; content: string; message?: string; branch?: string; sha?: string; userName?: string }
): Promise<WriteResult> {
  return apiFetch<WriteResult>(`${API_BASE}/api/repos/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        owner: params.owner,
        repo: params.repo,
        path: params.path,
        content: params.content,
        message: params.message || formatTimestamp(),
        branch: params.branch || 'main',
        sha: params.sha,
        userName: params.userName
      }),
    });
}

export async function deleteFile(
  params: RepoInfo & { path: string; sha: string; message?: string; userName?: string }
): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/repos/file`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      sha: params.sha,
      message: params.message || '[skip ci]',
      userName: params.userName
    }),
  }, true);
}

/**
 * 移动文件（读 + 写新路径 + 删旧路径）
 * 注意：GitHub API 不支持原子移动，此为最佳努力方案
 * 如果写入成功但删除失败，会产生重复文件（需手动清理）
 */
export async function moveFile(
  params: RepoInfo & { fromPath: string; toPath: string; sha?: string; message?: string; userName?: string }
) {
  const { content: fileContent, sha: currentSha } = await readFile({
    owner: params.owner,
    repo: params.repo,
    path: params.fromPath,
    branch: params.branch
  });

  const resolvedMessage = params.message || `移动：${params.fromPath} → ${params.toPath}`;

  await writeFile({
    owner: params.owner,
    repo: params.repo,
    path: params.toPath,
    content: fileContent,
    message: resolvedMessage,
    branch: params.branch,
    userName: params.userName
  });

  try {
    await deleteFile({
      owner: params.owner,
      repo: params.repo,
      path: params.fromPath,
      sha: params.sha || currentSha,
      // 删除源文件的 commit 不应再次触发 CI（写入侧已按需触发）
      message: `[skip ci] ${resolvedMessage}`,
      userName: params.userName
    });
  } catch (err) {
    // 写入成功但删除失败：向上传播错误，让调用者提示用户手动清理
    throw new Error(`文件已写入 ${params.toPath}，但删除源文件 ${params.fromPath} 失败，仓库中可能存在重复文件。原因：${err instanceof Error ? err.message : '未知错误'}`);
  }
}

/**
 * 重命名文件（写入新路径 + 删除旧路径）
 */
export async function renameFile(
  params: RepoInfo & { oldPath: string; newPath: string; content: string; sha?: string; message?: string; branch?: string; userName?: string }
) {
  const resolvedMessage = params.message || `重命名：${params.oldPath} → ${params.newPath}`;

  await writeFile({
    owner: params.owner,
    repo: params.repo,
    path: params.newPath,
    content: params.content,
    message: resolvedMessage,
    branch: params.branch,
    userName: params.userName
  });

  try {
    if (params.sha) {
      await deleteFile({
        owner: params.owner,
        repo: params.repo,
        path: params.oldPath,
        sha: params.sha,
        // 删除旧文件的 commit 不应再次触发 CI（写入侧已按需触发）
        message: `[skip ci] ${resolvedMessage}`,
        userName: params.userName
      });
    } else {
      throw new Error('缺少 sha，无法删除旧文件');
    }
  } catch (err) {
    // 写入成功但删除失败：向上传播错误，让调用者提示用户手动清理
    throw new Error(`文件已写入 ${params.newPath}，但删除旧文件 ${params.oldPath} 失败，仓库中可能存在重复文件。原因：${err instanceof Error ? err.message : '未知错误'}`);
  }
}

export async function getBranches(
  owner: string,
  repo: string
): Promise<string[]> {
  const searchParams = new URLSearchParams({ owner, repo });
  return apiFetch<string[]>(`${API_BASE}/api/repos/branches?${searchParams}`);
}

/**
 * 创建分支（基于源分支最新 commit）
 */
export async function createBranch(params: {
  owner: string;
  repo: string;
  branchName: string;
  sourceBranch?: string;
}): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/repos/branch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }, true);
}

/**
 * 使用 GitHub Trees API 一次性获取整个目录树（替代递归扫描）
 * mode: 'filename' = 额外通过 commits API 填充 lastModified（媒体库按最新排序用）
 *       省略      = 不查询 commits，lastModified 保持 0；内容库/草稿箱/回收站
 *                   的排序依赖 front-matter 的 date，不需要该字段
 * 限制：单次最多返回 800 个文件，超限则抛出错误（GitHub API 上限 1000）
 */
export async function getTree(params: RepoInfo & { mode?: 'filename' }): Promise<TreeItem[]> {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    branch: params.branch || 'main'
  });
  if (params.mode) searchParams.set('mode', params.mode);

  const result = await apiFetch<TreeItem[]>(`${API_BASE}/api/repos/tree?${searchParams}`);

  if (result.length > MAX_TREE_ITEMS) {
    throw new Error(`目录文件数超过 ${MAX_TREE_ITEMS} 个上限，请检查仓库规模`);
  }

  return result;
}

/**
 * 上传图片（base64 编码）
 */
export async function uploadImage(
  params: RepoInfo & { path: string; base64Content: string; message?: string; branch?: string; userName?: string; sha?: string }
): Promise<WriteResult> {
  return apiFetch<WriteResult>(`${API_BASE}/api/repos/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      base64Content: params.base64Content,
      message: params.message || formatTimestamp(),
      branch: params.branch || 'main',
      userName: params.userName,
      sha: params.sha
    }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/auth/logout`, {
    method: 'POST'
  }, true);
}

/** 设备列表条目 */
export interface DeviceEntry {
  /** 设备指纹（哈希） */
  fingerprint: string;
  /** 是否受信任 */
  trusted: boolean;
  /** 最近活跃时间戳 */
  lastLoginAt: number;
  /** UA 描述字符串（可能为空） */
  ua: string | null;
  /** 是否为当前访问设备 */
  isCurrent: boolean;
}

/** 列出所有已登录设备 */
export async function listDevices(): Promise<DeviceEntry[]> {
  return apiFetch<DeviceEntry[]>(`${API_BASE}/api/auth/devices`);
}

/** 删除指定设备（撤销信任） */
export async function deleteDevice(fingerprint: string): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/auth/devices/${encodeURIComponent(fingerprint)}`, {
    method: 'DELETE'
  }, true);
}

/** 设置当前设备是否受信任（true=7 天续期，false=6 小时） */
export async function setDeviceTrusted(trusted: boolean): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/auth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trusted })
  }, true);
}

// ---------- 批量提交（Git Data API，多文件变更合并为单 commit） ----------

/**
 * 批量提交：N 个文件变更 → 1 个 commit → 最多触发 1 次 CI。
 * 原子性：失败时整批不写入，不会出现「发布一半」的中间状态。
 */
export async function commitBatch(
  params: RepoInfo & { message: string; ops: CommitOp[]; userName?: string }
): Promise<{ sha: string }> {
  return apiFetch<{ sha: string }>(`${API_BASE}/api/repos/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: params.owner,
      repo: params.repo,
      branch: params.branch || 'main',
      message: params.message,
      ops: params.ops,
      userName: params.userName
    }),
    // 批量提交需走 Git Data API 多次往返，超时高于默认值
    timeoutMs: 30000,
  });
}

// ---------- front-matter 聚合提取 ----------

export interface ExtractedFrontmatter {
  path: string;
  format: 'yaml' | 'toml';
  raw: string;
}

/** 单次请求批量拉取多个文件的 front-matter 原文（Worker 侧并发读取） */
export async function extractBatch(
  params: RepoInfo & { paths: string[] }
): Promise<{ results: ExtractedFrontmatter[]; errors: Array<{ path: string; error: string }> }> {
  return apiFetch<{ results: ExtractedFrontmatter[]; errors: Array<{ path: string; error: string }> }>(
    `${API_BASE}/api/repos/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: params.owner,
        repo: params.repo,
        branch: params.branch || 'main',
        paths: params.paths
      })
    }
  );
}

// ---------- 手动部署 ----------

export interface WorkflowInfo {
  id: number;
  name: string;
  path: string;
  state: string;
}

export async function getWorkflows(owner: string, repo: string): Promise<WorkflowInfo[]> {
  const searchParams = new URLSearchParams({ owner, repo });
  return apiFetch<WorkflowInfo[]>(`${API_BASE}/api/repos/workflows?${searchParams}`);
}

export async function triggerDeploy(params: {
  owner: string;
  repo: string;
  workflowId: number;
  ref?: string;
}): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/repos/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  }, true);
}
