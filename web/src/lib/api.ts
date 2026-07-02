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

const API_BASE = import.meta.env.VITE_API_URL || '';

const API_TIMEOUT_MS = 10000;

/**
 * 统一 API 请求封装，自动处理错误响应
 */
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw new Error('网络连接失败');
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  if (!data.success) throw new Error(data.error || '请求失败');
  return data.data;
}

export async function getRepos(token: string) {
  return apiFetch(`${API_BASE}/api/repos`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function getFiles(token: string, params: RepoInfo & { path?: string }) {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    path: params.path || '',
    branch: params.branch || 'main'
  });

  return apiFetch(`${API_BASE}/api/repos/files?${searchParams}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function readFile(token: string, params: RepoInfo & { path: string }) {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    branch: params.branch || 'main'
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return apiFetch(`${API_BASE}/api/repos/file?${searchParams}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function writeFile(
  token: string,
  params: RepoInfo & { path: string; content: string; message?: string; branch?: string; sha?: string; userName?: string }
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rawMessage = params.message;
  const isSkipCi = rawMessage && rawMessage.trimStart().startsWith('[skip ci]');
  const message = isSkipCi ? rawMessage : `${rawMessage || timestamp} (${timestamp})`;
  return apiFetch(`${API_BASE}/api/repos/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      content: params.content,
      message,
      branch: params.branch || 'main',
      sha: params.sha,
      userName: params.userName
    })
  });
}

export async function deleteFile(
  token: string,
  params: RepoInfo & { path: string; sha: string; message?: string }
) {
  return apiFetch(`${API_BASE}/api/repos/file`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      sha: params.sha,
      message: params.message || '[skip ci]'
    })
  });
}

/**
 * 移动文件（读 + 写新路径 + 删旧路径）
 * 注意：GitHub API 不支持原子移动，此为最佳努力方案
 * 如果写入成功但删除失败，会产生重复文件（需手动清理）
 */
export async function moveFile(
  token: string,
  params: RepoInfo & { fromPath: string; toPath: string; sha?: string; message?: string }
) {
  // 1. 读取源文件
  const { content: fileContent, sha: currentSha } = await readFile(token, {
    owner: params.owner,
    repo: params.repo,
    path: params.fromPath,
    branch: params.branch
  });

  // 2. 写入目标路径
  await writeFile(token, {
    owner: params.owner,
    repo: params.repo,
    path: params.toPath,
    content: fileContent,
    message: params.message || `Move: ${params.fromPath} -> ${params.toPath}`,
    branch: params.branch
  });

  // 3. 删除源文件（如果失败，文件会同时存在于两个路径）
  try {
    await deleteFile(token, {
      owner: params.owner,
      repo: params.repo,
      path: params.fromPath,
      sha: params.sha || currentSha,
      message: params.message
    });
  } catch (err) {
    console.warn(`移动文件后删除源文件失败: ${params.fromPath}`, err);
    // 不抛出异常，避免前端状态不一致
    // 用户可以在内容库中手动删除重复文件
  }
}

export async function getBranches(
  token: string,
  owner: string,
  repo: string
) {
  const searchParams = new URLSearchParams({ owner, repo });
  return apiFetch(`${API_BASE}/api/repos/branches?${searchParams}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

/**
 * 使用 GitHub Trees API 一次性获取整个目录树（替代递归扫描）
 */
export async function getTree(token: string, params: RepoInfo) {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    branch: params.branch || 'main'
  });

  return apiFetch(`${API_BASE}/api/repos/tree?${searchParams}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}
