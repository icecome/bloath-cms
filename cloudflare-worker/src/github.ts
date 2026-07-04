// Cloudflare Workers 后端 - GitHub API 封装
// 用于在 Cloudflare Workers 中运行

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FRONTEND_URL: string;
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

  const data = await response.json() as { message?: string };
  if (!response.ok) {
    throw new Error(data.message || 'Failed to exchange code for token');
  }

  const tokenData = data as { access_token?: string };
  return tokenData.access_token!;
}

// 获取用户信息
export async function getUserInfo(token: string): Promise<UserInfo> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Bloath-CMS'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch user info: ${response.status} - ${error}`);
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
    throw new Error('Failed to fetch repositories');
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
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to read file: ${response.statusText}`);
  }

  const data = await response.json() as { content: string; sha: string };
  // Cloudflare Workers don't have Buffer, use atob instead
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
  author?: { name: string; email: string }
): Promise<void> {
  const base64Content = btoa(unescape(encodeURIComponent(content)));

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
    const error = await response.json() as { message?: string };
    throw new Error(error.message || 'Failed to write file');
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
    const error = await response.json() as { message?: string };
    throw new Error(error.message || 'Failed to delete file');
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
    const errorBody = await response.text();
    throw new Error(`${response.status}: ${response.statusText} - ${errorBody}`);
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
    const errorBody = await response.text();
    throw new Error(`${response.status}: ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json() as { tree: any[] };
  // 只返回文件，过滤掉目录和子模块
  return data.tree
    .filter((item: any) => item.type === 'blob')
    .map((item: any) => ({
      name: item.path.split('/').pop() || item.path,
      path: item.path,
      sha: item.sha,
      type: 'file' as const,
      size: item.size
    }));
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

// 文件信息
export interface FileInfo {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
}
