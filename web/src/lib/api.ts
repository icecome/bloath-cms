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

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

export async function getRepos(token: string) {
  const res = await fetch(`${API_BASE}/api/repos`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.success ? data.data : [];
}

export async function getFiles(token: string, params: RepoInfo & { path?: string }) {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    path: params.path || '',
    branch: params.branch || 'main'
  });

  const res = await fetch(`${API_BASE}/api/repos/files?${searchParams}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to load files');
  return data.data;
}

export async function readFile(token: string, params: RepoInfo & { path: string }) {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    branch: params.branch || 'main'
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${API_BASE}/api/repos/file?${searchParams}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to read file');
    return data.data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function writeFile(
  token: string,
  params: RepoInfo & { path: string; content: string; message?: string; branch?: string; sha?: string }
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rawMessage = params.message;
  const isSkipCi = rawMessage && rawMessage.trimStart().startsWith('[skip ci]');
  const message = isSkipCi ? rawMessage : `${rawMessage || timestamp} (${timestamp})`;
  const res = await fetch(`${API_BASE}/api/repos/file`, {
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
      author: { name: 'Bloath', email: 'cms@bloath.app' }
    })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to write file');
  return data.data;
}

export async function deleteFile(
  token: string,
  params: RepoInfo & { path: string; sha: string; message?: string }
) {
  const res = await fetch(`${API_BASE}/api/repos/file`, {
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
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to delete file');
  return data;
}

/**
 * 移动文件（读 + 写新路径 + 删旧路径）
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

  // 3. 删除源文件
  await deleteFile(token, {
    owner: params.owner,
    repo: params.repo,
    path: params.fromPath,
    sha: params.sha || currentSha,
    message: params.message
  });
}

export async function getBranches(
  token: string,
  owner: string,
  repo: string
) {
  const searchParams = new URLSearchParams({ owner, repo });
  const res = await fetch(`${API_BASE}/api/repos/branches?${searchParams}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to load branches');
  return data.data;
}
