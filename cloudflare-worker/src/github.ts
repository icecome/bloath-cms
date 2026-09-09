// Cloudflare Workers 后端 - GitHub API 封装
// 用于在 Cloudflare Workers 中运行

import type { FileInfo, Repo, User, CommitOp } from '../../shared/types';
import { FRONTMATTER_YAML_REGEX, FRONTMATTER_TOML_REGEX } from '../../shared/types';

export type { CommitOp };

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

// Git Data API 批量操作
interface GHTreeEntry {
  path: string;
  mode?: string;
  type?: string;
  sha?: string | null;
  content?: string;
}

interface GitHubRequestInit {
  method?: string;
  body?: unknown;
}

// GitHub API 请求封装：JSON 收发 + 统一错误处理
async function githubApi<T>(url: string, token: string, init: GitHubRequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Bloath-CMS',
      Accept: 'application/vnd.github+json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
  });
  if (!response.ok) {
    await throwGithubError(response, `GitHub API ${init.method || 'GET'} ${url.split('?')[0]}`);
  }
  return response.json() as Promise<T>;
}

/**
 * 批量提交：把多个文件变更合并为单个 commit（Git Data API）。
 * 步骤：get ref → get commit/tree → （必要时建 blob）→ create tree → create commit → update ref。
 * update ref 前复查基线 sha，检测并发修改后返回 409，避免静默覆盖。
 */
export async function batchCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  ops: CommitOp[],
  author?: { name: string; email: string }
): Promise<{ sha: string }> {
  const base = `https://api.github.com/repos/${owner}/${repo}/git`;

  // 1. 基线 ref 与 commit
  const refData = await githubApi<{ object: { sha: string } }>(
    `${base}/ref/heads/${encodeURIComponent(branch)}`, token
  );
  const baseSha = refData.object.sha;

  const commitData = await githubApi<{ tree: { sha: string } }>(
    `${base}/commits/${baseSha}`, token
  );
  const baseTreeSha = commitData.tree.sha;

  // 2. move/delete 需要源 blob sha：一次全量树建立 path → sha 映射
  const needSourceShas = ops.some((op) => op.op === 'move' || op.op === 'delete');
  const blobShaByPath = new Map<string, string>();
  if (needSourceShas) {
    const treeData = await githubApi<{ tree: Array<{ path: string; sha: string; type: string }> }>(
      `${base}/trees/${baseTreeSha}?recursive=1`, token
    );
    for (const item of treeData.tree) {
      if (item.type === 'blob') blobShaByPath.set(item.path, item.sha);
    }
  }

  // 3. 并行创建所有二进制 blob（仅 base64 需上传），再按 path 组装 entries
  const binaryOps = ops.filter((op) => op.op === 'write' && op.base64Content);
  const blobShaByTarget = new Map<string, string>();
  if (binaryOps.length > 0) {
    await Promise.all(binaryOps.map(async (op) => {
      const blob = await githubApi<{ sha: string }>(`${base}/blobs`, token, {
        method: 'POST',
        body: { content: op.base64Content, encoding: 'base64' }
      });
      blobShaByTarget.set(op.path, blob.sha);
    }));
  }

  const entries: GHTreeEntry[] = [];
  for (const op of ops) {
    if (op.op === 'write') {
      if (op.base64Content) {
        const blobSha = blobShaByTarget.get(op.path);
        if (!blobSha) continue;
        entries.push({ path: op.path, mode: '100644', type: 'blob', sha: blobSha });
      } else {
        entries.push({ path: op.path, mode: '100644', type: 'blob', content: op.content ?? '' });
      }
    } else if (op.op === 'move') {
      const fromPath = op.fromPath;
      const srcSha = fromPath ? blobShaByPath.get(fromPath) : undefined;
      if (!fromPath || !srcSha) {
        throw new ApiError(`移动源文件不存在或不可访问: ${op.fromPath}`, 400);
      }
      entries.push({ path: op.path, mode: '100644', type: 'blob', sha: srcSha });
      entries.push({ path: fromPath, mode: '100644', type: 'blob', sha: null });
    } else {
      const srcSha = blobShaByPath.get(op.path);
      if (!srcSha) {
        throw new ApiError(`待删除文件不存在或不可访问: ${op.path}`, 400);
      }
      entries.push({ path: op.path, mode: '100644', type: 'blob', sha: null });
    }
  }

  // 4. 建 tree → commit → 更新 ref
  const newTree = await githubApi<{ sha: string }>(`${base}/trees`, token, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: entries }
  });

  const newCommit = await githubApi<{ sha: string }>(`${base}/commits`, token, {
    method: 'POST',
    body: {
      message,
      tree: newTree.sha,
      parents: [baseSha],
      ...(author ? { author: { name: author.name, email: author.email } } : {})
    }
  });

  // 5. 并发冲突检查：基线被他人推进时拒绝写入，由上层提示重试
  const recheck = await githubApi<{ object: { sha: string } }>(
    `${base}/ref/heads/${encodeURIComponent(branch)}`, token
  );
  if (recheck.object.sha !== baseSha) {
    throw new ApiError('分支在提交期间已被并发修改，请重试', 409);
  }

  await githubApi<{ object: { sha: string } }>(
    `${base}/refs/heads/${encodeURIComponent(branch)}`, token, {
      method: 'PATCH',
      body: { sha: newCommit.sha, force: false }
    }
  );

  return { sha: newCommit.sha };
}

/**
 * 聚合提取 front-matter：一次请求内并发读取多个 md，仅返回 front-matter 原文，
 * 把列表页的 N 次 readFile 压缩为 1 次往返。
 */
export interface ExtractedFrontmatter {
  path: string;
  format: 'yaml' | 'toml';
  raw: string;
}

const FRONTMATTER_SNAPSHOT_LIMIT = 8192;

function sliceFrontmatter(content: string): { format: 'yaml' | 'toml'; raw: string } {
  const snapshot = content.slice(0, FRONTMATTER_SNAPSHOT_LIMIT);
  const yamlMatch = snapshot.match(FRONTMATTER_YAML_REGEX);
  if (yamlMatch) return { format: 'yaml', raw: yamlMatch[1] ?? '' };
  const tomlMatch = snapshot.match(FRONTMATTER_TOML_REGEX);
  if (tomlMatch) return { format: 'toml', raw: tomlMatch[1] ?? '' };
  return { format: 'yaml', raw: '' };
}

export async function extractFrontMatters(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  paths: string[]
): Promise<{ results: ExtractedFrontmatter[]; errors: Array<{ path: string; error: string }> }> {
  const results: ExtractedFrontmatter[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const CONCURRENCY = 8;

  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const chunk = paths.slice(i, i + CONCURRENCY);
    type ExtractItem = { path: string; format: 'yaml' | 'toml'; raw: string } | { path: string; error: string };
    const settled: ExtractItem[] = await Promise.all(
      chunk.map(async (path): Promise<ExtractItem> => {
        try {
          const { content } = await readFile(token, owner, repo, path, branch);
          return { path, ...sliceFrontmatter(content) };
        } catch (err) {
          return { path, error: err instanceof Error ? err.message : 'read failed' };
        }
      })
    );
    for (const item of settled) {
      if ('error' in item) {
        errors.push({ path: item.path, error: item.error });
      } else {
        results.push({ path: item.path, format: item.format, raw: item.raw });
      }
    }
  }

  return { results, errors };
}

// ---------- 手动部署（workflow dispatch） ----------

export interface WorkflowInfo {
  id: number;
  name: string;
  path: string;
  state: string;
}

export async function listWorkflows(token: string, owner: string, repo: string): Promise<WorkflowInfo[]> {
  const data = await githubApi<{ workflows: WorkflowInfo[] }>(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows?per_page=100`, token
  );
  return data.workflows.filter((w) => w.state === 'active');
}

export async function dispatchWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflowId: number,
  ref: string
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Bloath-CMS',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref })
    }
  );
  // GitHub 成功时返回 204（无响应体）
  if (!response.ok) {
    await throwGithubError(response, 'Failed to dispatch workflow');
  }
}

// 获取仓库目录树（recursive，仅返回文件；lastModified 恒为 0，排序逻辑在前端）
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