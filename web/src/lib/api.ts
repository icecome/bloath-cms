import type { Repo } from '../../../shared/types';

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

export interface RepoInfo {
  owner: string;
  repo: string;
  branch?: string;
}

import { API_BASE } from './constants';

const API_TIMEOUT_MS = 10000;

/**
 * 生成本地时间戳，格式 YYYYMMDDTHHmmss（依赖浏览器本地时区）
 */
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
 * 统一 API 请求封装，自动处理错误响应
 * @param skipDataCheck - 为 true 时不检查 data 字段（用于 DELETE 等无返回数据的接口）
 */
async function apiFetch<T>(url: string, options?: RequestInit, skipDataCheck = false): Promise<T> {
  const finalOptions: RequestInit = {
    ...options,
    credentials: 'include'
  };

  if (!finalOptions.headers) {
    finalOptions.headers = {};
  }
  (finalOptions.headers as Record<string, string>)['X-Requested-With'] = 'XMLHttpRequest';

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
    })
  });
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
    console.warn(`移动文件后删除源文件失败: ${params.fromPath}`, err);
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
      console.warn(`renameFile: sha 为空，跳过删除旧文件 ${params.oldPath}`);
    }
  } catch (err) {
    console.warn(`重命名后删除旧文件失败: ${params.oldPath}`, err);
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
 * 使用 GitHub Trees API 一次性获取整个目录树（替代递归扫描）
 * mode: 'commits' = 通过 commits API 获取时间（内容库/草稿箱/回收站）
 *       'filename' = 优先从文件名提取时间，回退到 commits API（媒体库）
 */
export async function getTree(params: RepoInfo & { mode?: 'commits' | 'filename' }): Promise<TreeItem[]> {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    branch: params.branch || 'main'
  });
  if (params.mode) searchParams.set('mode', params.mode);

  return apiFetch<TreeItem[]>(`${API_BASE}/api/repos/tree?${searchParams}`);
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
    })
  });
}

export async function logout(): Promise<void> {
  await apiFetch<void>(`${API_BASE}/api/auth/logout`, {
    method: 'POST'
  }, true);
}
