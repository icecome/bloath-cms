import type { Repo, RepoInfo, CommitOp } from '../../../shared/types';
import { API_BASE } from './constants';
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
  /** 写入后的新 blob sha；保存成功后前端据以更新本地基线（P0-005） */
  sha?: string | null;
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

// moveFile / renameFile 已删除（P2 裁剪）：二者是「写新 + 删旧」两步非原子操作，
// 中途失败会留重复文件；live 路径全部走 commitBatch（Git Data API 单 commit 原子）。
// 留着只会误导未来调用者重新踩坑。

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
 * 仓库整体超限时由 worker 侧显式报错（truncated 守卫），此处不再按总数硬失败——
 * 旧 800 上限按整仓计数（md+媒体+主题全算），目标规模仓库会被误伤（P0-003）。
 */
export async function getTree(params: RepoInfo & { mode?: 'filename' }): Promise<TreeItem[]> {
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
    }),
  });
}

/**
 * 上传媒体二进制（视频 / 原图模式）。
 *
 * 与 uploadImage 的区别：走 PUT /api/repos/media，body 是原始字节而非 base64 JSON，
 * 避免 33% 膨胀与 JSON.stringify 的额外内存复制。上限见 mediaLimits.ts。
 */
export async function uploadMediaBinary(params: {
  owner: string;
  repo: string;
  path: string;
  blob: Blob;
  message?: string;
  branch?: string;
  userName?: string;
  sha?: string;
}): Promise<WriteResult> {
  const search = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    branch: params.branch || 'main',
  });
  if (params.message) search.set('message', params.message);
  if (params.userName) search.set('userName', params.userName);
  if (params.sha) search.set('sha', params.sha);

  return apiFetch<WriteResult>(`${API_BASE}/api/repos/media?${search}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: params.blob,
    // 超时随体积线性放大：固定 120s 在慢上行（手机热点）传大视频时必然中途夭折（P2-16）。
    // 基准 1MB/2s + 30s 余量，100MB ≈ 230s；上限 10 分钟防死循环。
    timeoutMs: Math.min(30_000 + (params.blob.size / (1024 * 1024)) * 2_000, 600_000),
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

// ---------- 文件提交历史（编辑器历史侧栏数据源） ----------

export interface FileCommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  htmlUrl: string;
}

/** 列出某文件的提交历史（commits API 按 path 过滤，最多 30 条） */
export async function listFileCommits(
  params: RepoInfo & { path: string }
): Promise<FileCommitInfo[]> {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo,
    branch: params.branch || 'main',
    path: params.path
  });
  return apiFetch<FileCommitInfo[]>(`${API_BASE}/api/repos/commits?${searchParams}`);
}

// ---------- 部署状态（顶栏徽章数据源） ----------

export interface DeployRunView {
  id: number;
  name: string;
  headBranch: string;
  status: 'queued' | 'in_progress' | 'completed' | 'cancelled' | 'unknown';
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  displayTitle: string;
}

/** 拉取仓库最近的 Actions runs（失败降级为空 runs + error 说明） */
export async function getDeployStatus(
  params: RepoInfo
): Promise<{ runs: DeployRunView[]; error: string }> {
  const searchParams = new URLSearchParams({
    owner: params.owner,
    repo: params.repo
  });
  return apiFetch<{ runs: DeployRunView[]; error: string }>(
    `${API_BASE}/api/repos/deploy-status?${searchParams}`,
    { timeoutMs: 8000 }
  );
}
