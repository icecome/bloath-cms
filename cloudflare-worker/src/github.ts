// Cloudflare Workers 后端 - GitHub API 封装
// 用于在 Cloudflare Workers 中运行

import type { FileInfo, Repo, User } from '../../shared/types';

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FRONTEND_URL: string;
  ALLOWED_ORIGINS?: string;
  PROD_ORIGINS?: string;
  CONTENT_SECURITY_POLICY?: string;
}

// 自定义 API 错误类，携带 HTTP 状态码
export class ApiError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// 统一 GitHub API 错误处理：解析响应体并抛出 ApiError
// GitHub 403 通常来自速率限制（无 PAT 时每小时 60 次），用 503 向上传播而非 403（避免前端误判为认证过期）
async function throwGithubError(response: Response, context: string): Promise<never> {
  let message = `${context}: ${response.status}`;
  let statusCode = response.status;
  try {
    const body = await response.json() as { message?: string; documentation_url?: string };
    if (body.message) message = `${context}: ${body.message}`;
    // GitHub 速率限制：响应中包含 URL 说明文档地址
    if (response.status === 403 && body.documentation_url) statusCode = 503;
  } catch {
    // 响应体非 JSON，仅使用状态码
  }
  throw new ApiError(message, statusCode);
}

// UTF-8 字符串转 base64（替代已废弃的 unescape/encodeURIComponent 组合）
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 交换 code 获取 access_token
export async function exchangeCode(code: string, clientSecret: string, clientId: string, redirectUri: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });

  const data = await response.json() as { message?: string; error?: string; access_token?: string };
  if (!response.ok) {
    console.error('[exchangeCode] GitHub error:', response.status, data);
    throw new Error(data.message || data.error || 'Failed to exchange code for token');
  }

  if (!data.access_token) {
    console.error('[exchangeCode] No access_token returned:', JSON.stringify(data));
    throw new Error('GitHub returned empty access_token');
  }

  return data.access_token;
}

// 获取用户信息
export async function getUserInfo(token: string): Promise<User> {
  if (!token) {
    throw new Error('Empty access token');
  }
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Bloath-CMS'
    }
  });

  if (!response.ok) {
    await throwGithubError(response, 'Failed to get user info');
  }

  return response.json() as Promise<User>;
}

// GitHub API 返回的仓库原始结构
interface GHRepoResponse {
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  html_url: string;
  default_branch: string;
}

// 从 Link header 中解析下一页 URL
function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

// 获取用户仓库列表（自动分页，最多 5 页 = 500 仓库）
export async function getUserRepos(token: string): Promise<Repo[]> {
  const MAX_PAGES = 5;
  const allRepos: Repo[] = [];
  let url: string | null = 'https://api.github.com/user/repos?per_page=100';

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS'
      }
    });

    if (!response.ok) {
      await throwGithubError(response, 'Failed to get user repos');
    }

    const repos = await response.json() as GHRepoResponse[];
    allRepos.push(...repos.map(r => ({
      name: r.name,
      full_name: r.full_name,
      owner: r.owner?.login ?? '',
      repo: r.name,
      private: r.private,
      html_url: r.html_url,
      default_branch: r.default_branch
    })));

    url = parseNextPageUrl(response.headers.get('Link'));
  }

  return allRepos;
}

// 读取文件内容
export async function readFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string = 'main'
): Promise<{ content: string; sha: string }> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS'
      }
    }
  );

  if (!response.ok) {
    if (response.status === 404) throw new ApiError('File not found', 404);
    await throwGithubError(response, 'Failed to read file');
  }

  const data = await response.json() as { content: string; sha: string };
  // Cloudflare Workers 无 Buffer，使用 atob 解码 base64
  // GitHub API 返回的 content 是 ASCII-safe base64，charCodeAt 取低 8 位不会丢失数据
  const binaryString = atob(data.content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const text = new TextDecoder().decode(bytes);
  return {
    content: text,
    sha: data.sha
  };
}

// 创建或更新文件
export async function writeFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
  branch: string = 'main',
  author?: { name: string; email: string },
  isBase64 = false
): Promise<void> {
  // 如果内容已经是 base64 编码（如图片），直接使用；否则进行编码
  const base64Content = isBase64 ? content : utf8ToBase64(content);

  const payload: {
    message: string;
    content: string;
    branch: string;
    sha?: string;
    author?: { name: string; email: string };
  } = {
    message,
    content: base64Content,
    branch
  };

  if (sha) {
    payload.sha = sha;
  }

  if (author) {
    payload.author = author;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    await throwGithubError(response, 'Failed to write file');
  }
}

// 删除文件
export async function deleteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  message: string,
  branch: string = 'main',
  author?: { name: string; email: string }
): Promise<void> {
  const payload: {
    message: string;
    sha: string;
    branch?: string;
    author?: { name: string; email: string };
  } = {
    message,
    sha
  };

  if (author) {
    payload.author = author;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    await throwGithubError(response, 'Failed to delete file');
  }
}

// 列出目录内容
export async function listDir(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string = 'main'
): Promise<FileInfo[]> {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '');
  const apiUrl = normalizedPath
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${normalizedPath}?ref=${encodeURIComponent(branch)}`
    : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Bloath-CMS'
    }
  });

  if (!response.ok) {
    await throwGithubError(response, 'Failed to list directory');
  }

  const data = await response.json() as Array<{ name: string; path: string; sha: string; type: 'file' | 'dir'; size?: number }>;
  return data.map((item) => ({
    name: item.name,
    path: item.path,
    sha: item.sha,
    type: item.type,
    size: item.size
  }));
}

// 获取仓库分支列表（自动分页，最多 5 页 = 500 分支）
export async function getRepoBranches(
  token: string,
  owner: string,
  repo: string
): Promise<string[]> {
  const MAX_PAGES = 5;
  const allBranches: string[] = [];
  let url: string | null = `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS'
      }
    });

    if (!response.ok) {
      console.error(`[getRepoBranches] Failed to fetch branches: ${response.status}`);
      return ['main'];
    }

    const data = await response.json() as Array<{ name: string }>;
    allBranches.push(...data.map((branch) => branch.name));

    url = parseNextPageUrl(response.headers.get('Link'));
  }

  return allBranches;
}

// Git ref 名称合法字符校验（字母、数字、/、-、_、.）
function isValidGitRefName(name: string): boolean {
  if (!name || name.length > 200) return false;
  // 禁止以 . 或 / 开头，禁止连续点，禁止以 .lock 结尾
  if (/^[./]/.test(name) || /\.\./.test(name) || /\.lock$/.test(name)) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(name);
}

// 创建分支（基于源分支最新 commit）
export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  sourceBranch: string = 'main'
): Promise<void> {
  if (!isValidGitRefName(branchName)) {
    throw new ApiError('分支名包含非法字符', 400);
  }

  // 获取源分支最新 commit SHA
  const refResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(sourceBranch)}`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Bloath-CMS' } }
  );
  if (!refResponse.ok) {
    await throwGithubError(refResponse, 'Failed to get source branch ref');
  }
  const refData = await refResponse.json() as { object: { sha: string } };
  const sha = refData.object.sha;

  // 创建新分支引用
  const createResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha })
    }
  );
  if (!createResponse.ok) {
    if (createResponse.status === 422) {
      throw new ApiError(`分支 ${branchName} 已存在`, 422);
    }
    await throwGithubError(createResponse, 'Failed to create branch');
  }
}

// ============================================
// getTree() 中的 Commits API 调用已移除
// 排序逻辑已迁移至前端 extractFrontMatter.ts
// 此函数只返回文件列表，lastModified 均为 0
// ============================================
export async function getTree(
  token: string,
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<FileInfo[]> {
  // 获取文件列表
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS'
      }
    }
  );

  if (!response.ok) {
    await throwGithubError(response, 'Failed to get tree');
  }

  const data = await response.json() as { tree: Array<{ path: string; sha: string; type: string; size?: number }> };
  return data.tree
    .filter((item) => item.type === 'blob')
    .map((item) => {
      const name = item.path.split('/').pop() || item.path;
      return {
        name,
        path: item.path,
        sha: item.sha,
        type: 'file' as const,
        size: item.size,
        lastModified: 0
      };
    });
}