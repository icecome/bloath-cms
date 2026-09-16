import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../comment/types';
import { success, error } from '../comment/utils/response';
import {
  getUserRepos, readFile, writeFile, deleteFile, listDir,
  getRepoBranches, getTree, createBranch, batchCommit, extractFrontMatters,
  listWorkflows, dispatchWorkflow, buildCommitAuthor,
} from '../services/github';
import type { CommitOp } from '../services/github';
import { requireAuth, type AuthResult } from '../middleware/sessionAuth';
import { isSafePathParam, safeJsonParse, MAX_CONTENT_SIZE } from '../middleware/pathGuard';

const reposApp = new Hono<HonoEnv>();
reposApp.use('/api/repos/*', requireAuth);

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
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('Invalid owner or repo'), 400);
  if (path && !isSafePathParam(path, true)) return c.json(badRequest('Invalid path'), 400);
  if (!isSafePathParam(branch)) return c.json(badRequest('Invalid branch'), 400);
  const files = await listDir(auth(c).githubToken, owner, repo, path, branch);
  return c.json(success(files));
});

// GET /api/repos/file
reposApp.get('/api/repos/file', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const filePath = c.req.query('path');
  const branch = c.req.query('branch') || 'main';
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath) return c.json(badRequest('Missing required params'), 400);
  if (!isSafePathParam(filePath, true)) return c.json(badRequest('Invalid path'), 400);
  if (!isSafePathParam(branch)) return c.json(badRequest('Invalid branch'), 400);
  const file = await readFile(auth(c).githubToken, owner, repo, filePath, branch);
  return c.json(success(file));
});

// PUT /api/repos/file
reposApp.put('/api/repos/file', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, path: filePath, content, base64Content, message, sha, branch = 'main', userName } = data as {
    owner?: string; repo?: string; path?: string; content?: string; base64Content?: string;
    message?: string; sha?: string; branch?: string; userName?: string;
  };
  const fileContent = base64Content || content;
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !fileContent) return c.json(badRequest('Missing required fields'), 400);
  if (typeof fileContent === 'string' && fileContent.length > MAX_CONTENT_SIZE) return c.json(badRequest('File too large (max 10MB encoded)'), 400);
  if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) return c.json(badRequest('Invalid path or branch'), 400);
  const author = buildCommitAuthor(userName);
  await writeFile(auth(c).githubToken, owner, repo, filePath, fileContent, message || 'update file', sha, branch, author, !!base64Content);
  return c.json(success({ path: filePath }));
});

// DELETE /api/repos/file
reposApp.delete('/api/repos/file', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, path: filePath, sha, message, branch = 'main', userName } = data as {
    owner?: string; repo?: string; path?: string; sha?: string; message?: string; branch?: string; userName?: string;
  };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !sha) return c.json(badRequest('Missing required fields'), 400);
  if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) return c.json(badRequest('Invalid path or branch'), 400);
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
  const mode: 'filename' | 'commits' | undefined =
    modeParam === 'filename' ? 'filename' :
    modeParam === 'commits' ? 'commits' : undefined;
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('Missing owner or repo'), 400);
  if (!isSafePathParam(branch)) return c.json(badRequest('Invalid branch'), 400);
  const tree = await getTree(auth(c).githubToken, owner, repo, branch, mode);
  return c.json(success(tree));
});

// POST /api/repos/branch
reposApp.post('/api/repos/branch', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, branchName, sourceBranch = 'main' } = data as { owner?: string; repo?: string; branchName?: string; sourceBranch?: string };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(branchName)) return c.json(badRequest('Missing or invalid params'), 400);
  if (sourceBranch !== 'main' && !isSafePathParam(sourceBranch)) return c.json(badRequest('Invalid source branch'), 400);
  await createBranch(auth(c).githubToken, owner, repo, branchName, sourceBranch);
  return c.json(success(null));
});

// POST /api/repos/commit
reposApp.post('/api/repos/commit', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, branch = 'main', message, userName, ops } = data as {
    owner?: string; repo?: string; branch?: string; message?: string; userName?: string; ops?: CommitOp[];
  };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(branch)) return c.json(badRequest('Invalid owner, repo or branch'), 400);
  if (!message) return c.json(badRequest('Missing commit message'), 400);
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 200) return c.json(badRequest('ops 数量须在 1~200 之间'), 400);
  for (const op of ops) {
    const source = op.fromPath;
    if ((op.op !== 'write' && op.op !== 'move' && op.op !== 'delete') || !isSafePathParam(op.path, true) || (op.op === 'move' && (!source || !isSafePathParam(source, true)))) {
      return c.json(badRequest(`非法操作项: op=${op.op}, path=${op.path}${source ? `, from=${source}` : ''}`), 400);
    }
    if (op.op === 'write') {
      const len = typeof op.content === 'string' ? op.content.length : 0;
      const b64len = typeof op.base64Content === 'string' ? op.base64Content.length : 0;
      if (len === 0 && b64len === 0) return c.json(badRequest(`写入操作缺少内容: ${op.path}`), 400);
      if (len + b64len > MAX_CONTENT_SIZE) return c.json(badRequest(`文件过大（单文件上限 10MB）: ${op.path}`), 400);
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
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(branch)) return c.json(badRequest('Invalid owner, repo or branch'), 400);
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100 || paths.some((p) => !isSafePathParam(p, true))) {
    return c.json(badRequest('paths 须为 1~100 个合法路径'), 400);
  }
  const result = await extractFrontMatters(auth(c).githubToken, owner!, repo!, branch, paths);
  return c.json(success(result));
});

// GET /api/repos/workflows
reposApp.get('/api/repos/workflows', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('Missing owner or repo'), 400);
  const workflows = await listWorkflows(auth(c).githubToken, owner!, repo!);
  return c.json(success(workflows));
});

// POST /api/repos/deploy
reposApp.post('/api/repos/deploy', async (c: Context<HonoEnv>) => {
  const data = safeJsonParse(await c.req.raw.text());
  const { owner, repo, workflowId, ref = 'main' } = data as { owner?: string; repo?: string; workflowId?: number; ref?: string };
  if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(ref) || typeof workflowId !== 'number') {
    return c.json(badRequest('Invalid params'), 400);
  }
  await dispatchWorkflow(auth(c).githubToken, owner!, repo!, workflowId, ref);
  return c.json(success(null));
});

// GET /api/repos/:owner/:repo/branches
reposApp.get('/api/repos/:owner/:repo/branches', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner') || c.req.param('owner');
  const repo = c.req.query('repo') || c.req.param('repo');
  if (!isSafePathParam(owner) || !isSafePathParam(repo)) return c.json(badRequest('Missing owner or repo'), 400);
  const branches = await getRepoBranches(auth(c).githubToken, owner, repo);
  return c.json(success(branches));
});

export default reposApp;
