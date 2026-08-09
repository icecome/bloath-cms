import type { Repo, RepoInfo } from '../../../shared/types';
import { API_BASE, MAX_TREE_ITEMS } from './constants';

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

async function apiFetch<T>(url: string, options?: RequestInit, skipDataCheck = false): Promise<T> {
  const finalOptions: RequestInit = {
    ...options,
    credentials: 'include'
  };

  let res: Response;
  try {
    res = await fetch(url, finalOptions);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw new Error('网络连接失败');
  }

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('登录已过期，请重新登录');
  }

  if (res.status === 503) {
    throw new Error('GitHub API 暂不可用，请稍后重试');
  }

  let data: { success: boolean; data?: T; error?: string };
  try {
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    data = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  if (!data.success) throw new Error(data.error || '请求失败');
  if (!skipDataCheck) {
    if (data.data === undefined) throw new Error('响应数据为空');
  }
  return data.data as T;
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

  const controller = new AbortController();
  const effectiveTimeout = timeoutMs ?? API_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    return await apiFetch<FileReadResult>(`${API_BASE}/api/repos/file?${searchParams}`, {
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function writeFile(
  params: RepoInfo & { path: string; content: string; message?: string; branch?: string; sha?: string; userName?: string }
): Promise<WriteResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await apiFetch<WriteResult>(`${API_BASE}/api/repos/file`, {
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
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function deleteFile(
  params: RepoInfo & { path: string; sha: string; message?: string; userName?: string }
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
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
      signal: controller.signal
    }, true);
  } finally {
    clearTimeout(timeoutId);
  }
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

  const resolvedMessage = params.message || `Move: ${params.fromPath} -> ${params.toPath}`;

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
      message: resolvedMessage,
      userName: params.userName
    });
  } catch (err) {
    // 写入成功但删除失败：向上传播错误，让调用者提示用户手动清理
    throw new Error(`文件已写入 ${params.toPath}，但删除源文件 ${params.fromPath} 失败，仓库可能存在重复文件。原因: ${err instanceof Error ? err.message : '未知错误'}`);
  }
}

/**
 * 重命名文件（写入新路径 + 删除旧路径）
 */
export async function renameFile(
  params: RepoInfo & { oldPath: string; newPath: string; content: string; sha?: string; message?: string; branch?: string; userName?: string }
) {
  const resolvedMessage = params.message || `Rename: ${params.oldPath} -> ${params.newPath}`;

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
        message: resolvedMessage,
        userName: params.userName
      });
    } else {
      throw new Error('缺少 sha，无法删除旧文件');
    }
  } catch (err) {
    // 写入成功但删除失败：向上传播错误，让调用者提示用户手动清理
    throw new Error(`文件已写入 ${params.newPath}，但删除旧文件 ${params.oldPath} 失败，仓库可能存在重复文件。原因: ${err instanceof Error ? err.message : '未知错误'}`);
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    await apiFetch<void>(`${API_BASE}/api/repos/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal
    }, true);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 使用 GitHub Trees API 一次性获取整个目录树（替代递归扫描）
 * mode: 'commits' = 通过 commits API 获取时间（内容库/草稿箱/回收站）
 *       'filename' = 优先从文件名提取时间，回退到 commits API（媒体库）
 * 限制：单次最多返回 800 个文件，超限则抛出错误（GitHub API 上限 1000）
 */
export async function getTree(params: RepoInfo & { mode?: 'commits' | 'filename' }): Promise<TreeItem[]> {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    branch: params.branch || 'main'
  });
  if (params.mode) searchParams.set('mode', params.mode);

  const result = await apiFetch<TreeItem[]>(`${API_BASE}/api/repos/tree?${searchParams}`);

  if (result.length > MAX_TREE_ITEMS) {
    throw new Error(`目录文件数超过 ${MAX_TREE_ITEMS} 个上限，请检查仓库是否过大`);
  }

  return result;
}

/**
 * 上传图片（base64 编码）
 */
export async function uploadImage(
  params: RepoInfo & { path: string; base64Content: string; message?: string; branch?: string; userName?: string; sha?: string }
): Promise<WriteResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await apiFetch<WriteResult>(`${API_BASE}/api/repos/file`, {
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
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function logout(): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/auth/logout`, {
    method: 'POST'
  }, true);
}
