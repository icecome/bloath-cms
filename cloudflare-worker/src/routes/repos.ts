import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../lib/error-codes';
import { success, error } from '../lib/response';
import {
  getUserRepos, readFile, writeFile, deleteFile, listDir,
  getRepoBranches, getTree, createBranch, batchCommit, extractFrontMatters,
  listWorkflows, dispatchWorkflow, buildCommitAuthor, listFileCommits,
} from '../services/github';
import type { CommitOp } from '../services/github';
import { fetchRecentRuns } from '../services/deploy-status';
import { requireAuth, type AuthResult } from '../middleware/sessionAuth';
import { writeLimitAfterAuth } from '../middleware/writeLimit';
import { bytesToBase64 } from '../lib/base64';
import {
  isSafePathParam, safeJsonParse, MAX_CONTENT_SIZE, MAX_JSON_BODY_SIZE, MAX_MEDIA_BINARY_SIZE,
} from '../middleware/pathGuard';

const reposApp = new Hono<HonoEnv>();
reposApp.use('/api/repos/*', requireAuth);
// 限流必须挂在 requireAuth 之后：key 依赖 auth 中的 githubLogin（见 writeLimit.ts 头注释）
reposApp.use('/api/repos/*', writeLimitAfterAuth);

function auth(c: Context<HonoEnv>): AuthResult {
  return c.get('auth') as AuthResult;
}

function badRequest(message: string) {
  return error(ErrorCode.VALIDATION_ERROR, message);
}

// GET /api/repos
reposApp.get('/api/repos', async (c: Context<HonoEnv>) => {
  const repos = await getUserRepos(auth(c).githubToken);
  return c.json(success(repos.filter((repo) => repo.name !== '.github')));
});

// GET /api/repos/files
reposApp.get('/api/repos/files', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const path = c.req.query('path') || '';
  const branch = c.req.query('branch') || 'main';
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('owner 或 repo 参数无效'), 400);
  if (path && !isSafePathParam(path, true)) return c.json(badRequest('path 参数无效'), 400);
  if (!isSafePathParam(branch)) return c.json(badRequest('branch 参数无效'), 400);
  const files = await listDir(auth(c).githubToken, owner, repo, path, branch);
  return c.json(success(files));
});

// GET /api/repos/file
reposApp.get('/api/repos/file', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const filePath = c.req.query('path');
  const branch = c.req.query('branch') || 'main';
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath) return c.json(badRequest('缺少必填参数'), 400);
  if (!isSafePathParam(filePath, true)) return c.json(badRequest('path 参数无效'), 400);
  if (!isSafePathParam(branch)) return c.json(badRequest('branch 参数无效'), 400);
  const file = await readFile(auth(c).githubToken, owner, repo, filePath, branch);
  return c.json(success(file));
});

// PUT /api/repos/file
reposApp.put('/api/repos/file', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text(), MAX_JSON_BODY_SIZE);
  const { owner, repo, path: filePath, content, base64Content, message, sha, branch = 'main', userName } = data as {
    owner?: string; repo?: string; path?: string; content?: string; base64Content?: string;
    message?: string; sha?: string; branch?: string; userName?: string;
  };
  const fileContent = base64Content || content;
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !fileContent) return c.json(badRequest('缺少必填字段'), 400);
  if (typeof fileContent === 'string' && fileContent.length > MAX_CONTENT_SIZE) return c.json(badRequest('文件过大（单文件上限 15 MB）'), 400);
  if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) return c.json(badRequest('path 或 branch 参数无效'), 400);
  const author = buildCommitAuthor(userName);
  const result = await writeFile(auth(c).githubToken, owner, repo, filePath, fileContent, message || 'update file', sha, branch, author, !!base64Content);
  // 回传新 blob sha：前端保存成功后据以更新本地基线，避免下次保存带旧 sha 409（P0-005）
  return c.json(success({ path: filePath, sha: result.sha ?? null }));
});

// PUT /api/repos/media —— 二进制媒体上传（视频 / 原图模式）
//
// 为什么不复用 /api/repos/file：那条路径要求 base64 塞进 JSON，
// 视频体积下 base64 膨胀 33% 且 JSON.stringify 会再复制一份字符串，
// 峰值内存约为文件体积的 3 倍；此处直接收 arrayBuffer，只在提交给 GitHub 前
// 做一次 base64 编码，峰值降为 2 倍左右。
//
// 契约：
//   PUT /api/repos/media?owner=&repo=&branch=&path=&message=&sha=&userName=
//   Body: 原始字节（Content-Type 不限）
//   200 → { code:0, data:{ path } }
//   400 → 参数无效 / 空文件
//   413 → 超过 MAX_MEDIA_BINARY_SIZE
reposApp.put('/api/repos/media', async (c: Context<HonoEnv>) => {
  const q = (key: string) => c.req.query(key);
  const owner = q('owner');
  const repo = q('repo');
  const filePath = q('path');
  const branch = q('branch') || 'main';
  const sha = q('sha');
  const message = q('message');
  const userName = q('userName');

  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath) {
    return c.json(badRequest('缺少必填字段'), 400);
  }
  if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) {
    return c.json(badRequest('path 或 branch 参数无效'), 400);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) return c.json(badRequest('文件内容为空'), 400);
  if (bytes.byteLength > MAX_MEDIA_BINARY_SIZE) {
    return c.json(
      error(ErrorCode.PAYLOAD_TOO_LARGE, `文件超过 ${MAX_MEDIA_BINARY_SIZE / 1048576} MB 上限`),
      413
    );
  }

  // isBase64=true：内容已是 base64，writeFile 不再二次编码
  await writeFile(
    auth(c).githubToken, owner, repo, filePath, bytesToBase64(new Uint8Array(bytes)),
    message || 'upload media', sha, branch, buildCommitAuthor(userName), true
  );
  return c.json(success({ path: filePath }));
});

// DELETE /api/repos/file
reposApp.delete('/api/repos/file', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, path: filePath, sha, message, branch = 'main', userName } = data as {
    owner?: string; repo?: string; path?: string; sha?: string; message?: string; branch?: string; userName?: string;
  };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !sha) return c.json(badRequest('缺少必填字段'), 400);
  if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) return c.json(badRequest('path 或 branch 参数无效'), 400);
  const author = buildCommitAuthor(userName);
  await deleteFile(auth(c).githubToken, owner, repo, filePath, sha, message || 'delete file', branch, author);
  return c.json(success(null));
});

// GET /api/repos/tree
reposApp.get('/api/repos/tree', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const branch = c.req.query('branch') || 'main';
  const modeParam = c.req.query('mode');
  const mode: 'filename' | undefined = modeParam === 'filename' ? 'filename' : undefined;
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('缺少 owner 或 repo 参数'), 400);
  if (!isSafePathParam(branch)) return c.json(badRequest('branch 参数无效'), 400);
  const tree = await getTree(auth(c).githubToken, owner, repo, branch, mode, c.env.CACHE_KV);
  return c.json(success(tree));
});

// POST /api/repos/branch
reposApp.post('/api/repos/branch', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, branchName, sourceBranch = 'main' } = data as { owner?: string; repo?: string; branchName?: string; sourceBranch?: string };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(branchName)) return c.json(badRequest('参数缺失或无效'), 400);
  if (sourceBranch !== 'main' && !isSafePathParam(sourceBranch)) return c.json(badRequest('sourceBranch 参数无效'), 400);
  await createBranch(auth(c).githubToken, owner, repo, branchName, sourceBranch);
  return c.json(success(null));
});

// POST /api/repos/commit
reposApp.post('/api/repos/commit', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, branch = 'main', message, userName, ops } = data as {
    owner?: string; repo?: string; branch?: string; message?: string; userName?: string; ops?: CommitOp[];
  };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(branch)) return c.json(badRequest('owner、repo 或 branch 参数无效'), 400);
  if (!message) return c.json(badRequest('缺少提交信息 message'), 400);
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 200) return c.json(badRequest('ops 数量须在 1 至 200 之间'), 400);
  // 二进制 ops 上限（audit P2-36）：每个 base64Content 在 batchCommit 中触发一次
  // 独立 blob 上传子请求——免费版每次调用 50 子请求预算，>40 必然在 GitHub 侧
  // 中途失败（留下半完成的 tree）。文本 write 内联进 create-tree 不受此限。
  const binaryOps = ops.filter((op) => typeof op.base64Content === 'string' && op.base64Content.length > 0).length;
  if (binaryOps > 40) return c.json(badRequest(`二进制操作过多（${binaryOps} > 40），请分批提交`), 400);
  for (const op of ops) {
    const source = op.fromPath;
    if ((op.op !== 'write' && op.op !== 'move' && op.op !== 'delete') || !isSafePathParam(op.path, true) || (op.op === 'move' && (!source || !isSafePathParam(source, true)))) {
      return c.json(badRequest(`无效的操作项：op=${op.op}, path=${op.path}${source ? `, from=${source}` : ''}`), 400);
    }
    if (op.op === 'write') {
      const len = typeof op.content === 'string' ? op.content.length : 0;
      const b64len = typeof op.base64Content === 'string' ? op.base64Content.length : 0;
      if (len === 0 && b64len === 0) return c.json(badRequest(`写入操作缺少内容：${op.path}`), 400);
      if (len + b64len > MAX_CONTENT_SIZE) return c.json(badRequest(`文件过大（单文件上限 15 MB）：${op.path}`), 400);
    }
  }
  const author = buildCommitAuthor(userName);
  const result = await batchCommit(auth(c).githubToken, owner!, repo!, branch, message, ops, author);
  return c.json(success(result));
});

// POST /api/repos/extract
reposApp.post('/api/repos/extract', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, branch = 'main', paths } = data as { owner?: string; repo?: string; branch?: string; paths?: string[] };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(branch)) return c.json(badRequest('owner、repo 或 branch 参数无效'), 400);
  // 上限 40：免费版每次调用 50 子请求预算，每路径一次 GitHub readFile，
  // 旧上限 100 时第 51-100 个必然失败，触发前端逐文件回退风暴（P0-004）。
  // 须与前端 extractFrontMatter.ts 的 EXTRACT_CHUNK_SIZE 同步修改。
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 40 || paths.some((p) => !isSafePathParam(p, true))) {
    return c.json(badRequest('paths 须为 1 至 40 个有效路径'), 400);
  }
  const result = await extractFrontMatters(auth(c).githubToken, owner!, repo!, branch, paths);
  return c.json(success(result));
});

// GET /api/repos/workflows
reposApp.get('/api/repos/workflows', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('缺少 owner 或 repo 参数'), 400);
  const workflows = await listWorkflows(auth(c).githubToken, owner!, repo!);
  return c.json(success(workflows));
});

// POST /api/repos/deploy
reposApp.post('/api/repos/deploy', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, workflowId, ref = 'main' } = data as { owner?: string; repo?: string; workflowId?: number; ref?: string };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(ref) || typeof workflowId !== 'number') {
    return c.json(badRequest('参数无效'), 400);
  }
  await dispatchWorkflow(auth(c).githubToken, owner!, repo!, workflowId, ref);
  return c.json(success(null));
});

// GET /api/repos/deploy-status —— 最近 Actions runs（前端部署徽章数据源）
reposApp.get('/api/repos/deploy-status', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('缺少 owner 或 repo 参数'), 400);
  const result = await fetchRecentRuns(fetch, auth(c).githubToken, owner!, repo!);
  return c.json(success(result));
});

// GET /api/repos/commits —— 单文件提交历史（编辑器历史侧栏数据源）
reposApp.get('/api/repos/commits', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const branch = c.req.query('branch') || 'main';
  const filePath = c.req.query('path');
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath) return c.json(badRequest('缺少必填参数'), 400);
  if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) return c.json(badRequest('path 或 branch 参数无效'), 400);
  const commits = await listFileCommits(auth(c).githubToken, owner!, repo!, branch, filePath);
  return c.json(success(commits));
});

// GET /api/repos/branches —— 前端实际调用的形态（query 参数）。
// 注意：必须注册在 /api/repos/:owner/:repo/branches 之前不影响匹配（段数不同），
// 但两者语义等价，保留后者的原因是兼容已部署的旧前端。
reposApp.get('/api/repos/branches', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('缺少 owner 或 repo 参数'), 400);
  const branches = await getRepoBranches(auth(c).githubToken, owner!, repo!);
  return c.json(success(branches));
});

// GET /api/repos/:owner/:repo/branches（兼容形态）
reposApp.get('/api/repos/:owner/:repo/branches', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner') || c.req.param('owner');
  const repo = c.req.query('repo') || c.req.param('repo');
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('缺少 owner 或 repo 参数'), 400);
  const branches = await getRepoBranches(auth(c).githubToken, owner, repo);
  return c.json(success(branches));
});

export default reposApp;
