// Cloudflare Workers 后端 - GitHub API 封装
// 用于在 Cloudflare Workers 中运行

import type { FileInfo } from '../../shared/types';

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

  const tokenData = data as { access_token?: string };
  return tokenData.access_token!;
}

// 获取用户信息
export async function getUserInfo(token: string): Promise<UserInfo> {
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
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json() as Promise<UserInfo>;
}

// 获取用户邮箱
export async function getUserEmail(token: string): Promise<string | null> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Bloath-CMS'
    }
  });

  if (!response.ok) {
    return null;
  }

  const emails = await response.json() as any[];
  const primaryEmail = emails.find((e: any) => e.primary === true);
  return primaryEmail?.email || null;
}

// 获取用户仓库列表
export async function getUserRepos(token: string): Promise<Repo[]> {
  const response = await fetch('https://api.github.com/user/repos?per_page=100', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Bloath-CMS'
    }
  });

  if (!response.ok) {
    throw new Error('GitHub API error');
  }

  return response.json() as Promise<Repo[]>;
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
    throw new ApiError(response.status === 404 ? 'File not found' : `GitHub API error: ${response.status}`, response.status);
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
  const base64Content = isBase64 ? content : btoa(unescape(encodeURIComponent(content)));

  const payload: any = {
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
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
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
    throw new Error(`GitHub API error: ${response.status}`);
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
  const payload: any = {
    message,
    sha
  };

  if (author) {
    payload.author = author;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
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
    throw new Error(`GitHub API error: ${response.status}`);
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
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json() as any[];
  return data.map((item: any) => ({
    name: item.name,
    path: item.path,
    sha: item.sha,
    type: item.type,
    size: item.size
  }));
}

// 获取仓库分支列表
export async function getRepoBranches(
  token: string,
  owner: string,
  repo: string
): Promise<string[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS'
      }
    }
  );

  if (!response.ok) {
    // 如果获取失败，返回默认分支
    return ['main'];
  }

  const data = await response.json() as any[];
  return data.map((branch: any) => branch.name);
}

// 使用 GitHub Trees API 一次性获取整个目录树（替代递归扫描）
export async function getTree(
  token: string,
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<FileInfo[]> {
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
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json() as { tree: any[] };
  // 只返回文件，过滤掉目录和子模块
  const fileItems = data.tree
    .filter((item: any) => item.type === 'blob')
    .map((item: any) => {
      const name = item.path.split('/').pop() || item.path;
      return {
        name,
        path: item.path,
        sha: item.sha,
        type: 'file' as const,
        size: item.size,
        lastModified: 0 // 初始化为 0，后续通过 commits API 填充
      };
    });

  // 通过 commits API 获取每个文件的最后修改时间
  // 使用 per-file 查询：commits?path=xxx&per_page=1
  // 注：列表 API 默认不包含 files 数组，必须按路径单独查询
  try {
    const batchSize = 10;
    for (let i = 0; i < fileItems.length; i += batchSize) {
      const batch = fileItems.slice(i, i + batchSize);
      await Promise.all(batch.map(async (file) => {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(file.path)}&sha=${encodeURIComponent(branch)}&per_page=1`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Agent': 'Bloath-CMS'
            }
          }
        );
        if (resp.ok) {
          const data = await resp.json() as any[];
          if (data.length > 0) {
            file.lastModified = new Date(data[0].commit.committer.date).getTime();
          }
        }
      }));
    }
  } catch (err) {
    console.warn(`[getTree] Failed to fetch commits for lastModified: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // 按 lastModified 降序排序
  return fileItems.sort((a, b) => b.lastModified - a.lastModified);
}

// 获取用户信息
export interface UserInfo {
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}

// 仓库信息
export interface Repo {
  name: string;
  full_name: string;
  owner: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

// 获取用户信息