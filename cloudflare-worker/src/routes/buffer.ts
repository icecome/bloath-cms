import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../comment/types';
import { success, error } from '../comment/utils/response';
import { requireAuth, type AuthResult } from '../middleware/sessionAuth';
import { isSafePathParam, safeJsonParse, MAX_CONTENT_SIZE } from '../middleware/pathGuard';
import {
  getBufferConfigPublic, saveBufferConfig, type BufferConfigInput,
} from '../services/bufferConfig.service';
import { putObject } from '../services/s3.client';
import { isBlockedS3Endpoint, S3Error } from '../services/s3.errors';
import { getBufferConfig } from '../services/bufferConfig.service';
import {
  writeBufferEntry, deleteBufferEntry, setBufferPublishTarget, readBufferEntry,
  listBufferChanges, readFileWithBuffer, BufferUnavailableError,
} from '../services/buffer.service';
import { publishBuffer, type PublishItem } from '../services/publish.service';
import { GithubApiError } from '../services/github';

const bufferApp = new Hono<HonoEnv>();
bufferApp.use('/api/buffer/*', requireAuth);

function auth(c: Context<HonoEnv>): AuthResult {
  return c.get('auth') as AuthResult;
}

/**
 * 校验 owner/repo/branch 三个通用参数。
 * owner 与 repo 不允许含斜杠；branch 同样按单段路径处理。
 */
function areRepoParamsValid(owner: unknown, repo: unknown, branch: unknown): boolean {
  return isSafePathParam(owner as string | null | undefined)
    && isSafePathParam(repo as string | null | undefined)
    && isSafePathParam(branch as string | null | undefined);
}

/** 校验仓库参数 + 必填且允许斜杠的路径参数 */
function areRepoAndPathValid(owner: unknown, repo: unknown, branch: unknown, path: unknown): boolean {
  return areRepoParamsValid(owner, repo, branch)
    && !!path
    && isSafePathParam(path as string, true);
}

function respondBufferError(c: Context<HonoEnv>, err: unknown) {
  if (err instanceof BufferUnavailableError) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, err.message), 400);
  }
  if (err instanceof S3Error) {
    // S3 原始响应体只进日志，不回传客户端
    console.error(`[buffer] ${err.op} ${err.status}:`, err.detail);
    return c.json(error(ErrorCode.INTERNAL_ERROR, `对象存储操作失败（${err.status}）`), 502);
  }
  if (err instanceof GithubApiError) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, err.message), err.statusCode as 400 | 404 | 409 | 500 | 503);
  }
  console.error('[buffer] 未预期异常：', err);
  return c.json(error(ErrorCode.INTERNAL_ERROR, '服务器内部错误'), 500);
}

// ---------- 配置 ----------

// GET /api/buffer/config
bufferApp.get('/api/buffer/config', async (c: Context<HonoEnv>) => {
  const cfg = await getBufferConfigPublic(c.env);
  return c.json(success(cfg));
});

// PUT /api/buffer/config
bufferApp.put('/api/buffer/config', async (c: Context<HonoEnv>) => {
  let body: Partial<BufferConfigInput>;
  try { body = safeJsonParse(await c.req.raw.text()) as Partial<BufferConfigInput>; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { enabled, endpoint, region, bucket, accessKeyId, secretAccessKey, prefix } = body;
  if (typeof enabled !== 'boolean') return c.json(error(ErrorCode.VALIDATION_ERROR, 'enabled 需为布尔'), 400);
  if (enabled) {
    if (!endpoint || !bucket || !accessKeyId) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, 'endpoint / bucket / accessKeyId 不能为空'), 400);
    }
    if (!/^https?:\/\//.test(endpoint) || isBlockedS3Endpoint(endpoint)) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, 'endpoint 须为公网 http(s) URL，不允许内网/本机地址'), 400);
    }
    // secretAccessKey 允许为空（沿用已存值），但首次启用必须提供
    const existing = await getBufferConfig(c.env);
    if (!secretAccessKey && !existing) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, '首次启用需提供 secretAccessKey'), 400);
    }
  }
  try {
    await saveBufferConfig(c.env, {
      enabled, endpoint: endpoint || '', region, bucket: bucket || '',
      accessKeyId: accessKeyId || '', secretAccessKey: secretAccessKey || '', prefix,
    });
  } catch (err) {
    return c.json(error(ErrorCode.INTERNAL_ERROR, '配置保存失败'), 500);
  }
  // 启用后用实际会执行的动作（PutObject 写 .keep）探测，与「测试连接」一致。
  // HeadBucket 对仅授予对象级权限的凭证（如 R2 细粒度 token）会误判为连接失败。
  if (enabled) {
    try {
      const cfg = await getBufferConfig(c.env);
      if (cfg) {
        await putObject(cfg, `${cfg.prefix}/${cfg.rand}/.keep`, '');
      }
    } catch (err) {
      const msg = err instanceof S3Error ? err.message : 'S3 初始化失败';
      return c.json(error(ErrorCode.VALIDATION_ERROR, msg), 400);
    }
  }
  return c.json(success(await getBufferConfigPublic(c.env), '缓冲层配置已保存'));
});

// POST /api/buffer/config/test
bufferApp.post('/api/buffer/config/test', async (c: Context<HonoEnv>) => {
  let body: Partial<BufferConfigInput>;
  try { body = safeJsonParse(await c.req.raw.text()) as Partial<BufferConfigInput>; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  let endpoint = body.endpoint;
  let region = body.region;
  let bucket = body.bucket;
  let accessKeyId = body.accessKeyId;
  let secretAccessKey = body.secretAccessKey;
  let prefix = body.prefix;
  let rand = '';
  // 密钥为空时沿用已存配置
  if (!secretAccessKey) {
    const existing = await getBufferConfig(c.env);
    if (!existing) return c.json(error(ErrorCode.VALIDATION_ERROR, '缺少 secretAccessKey'), 400);
    secretAccessKey = existing.secretAccessKey;
    endpoint = endpoint || existing.endpoint;
    region = region || existing.region;
    bucket = bucket || existing.bucket;
    accessKeyId = accessKeyId || existing.accessKeyId;
    prefix = prefix || existing.prefix;
    rand = existing.rand;
  }
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '连接参数不完整'), 400);
  }
  const normalizedEndpoint = endpoint.replace(/\/+$/, '');
  if (isBlockedS3Endpoint(normalizedEndpoint)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'endpoint 不允许内网/本机地址'), 400);
  }
  try {
    // 用实际会执行的动作（PutObject 写 .keep）探测，仅需对象读写权限，
    // 避免仅对象级权限的凭证（如 R2 细粒度 token）在 HeadBucket 上被误判为连接失败
    const probeKey = `${prefix || 'tmp/blog'}/${rand || 'test'}/.keep`;
    await putObject({
      enabled: true, endpoint: normalizedEndpoint, region: region || 'auto',
      bucket, accessKeyId, secretAccessKey, prefix: prefix || 'tmp/blog', rand: rand || 'test',
    }, probeKey, '');
    return c.json(success({ ok: true }, '连接成功'));
  } catch (err) {
    const msg = err instanceof S3Error ? err.message : `连接异常：${(err as Error).message}`;
    return c.json(error(ErrorCode.VALIDATION_ERROR, msg), 400);
  }
});

// ---------- 缓冲 CRUD ----------

// GET /api/buffer/file?owner&repo&branch&path — 缓冲优先读取
bufferApp.get('/api/buffer/file', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const branch = c.req.query('branch') || 'main';
  const path = c.req.query('path');
  if (!areRepoAndPathValid(owner, repo, branch, path)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '参数不合法'), 400);
  }
  try {
    const result = await readFileWithBuffer(c.env, auth(c).githubToken, owner!, repo!, branch, path!);
    return c.json(success(result));
  } catch (err) {
    return respondBufferError(c, err);
  }
});

// PUT /api/buffer/file — 写入缓冲（write/delete/move）
bufferApp.put('/api/buffer/file', async (c: Context<HonoEnv>) => {
  let body: { owner?: string; repo?: string; branch?: string; path?: string; op?: string; content?: string; fromPath?: string; baseSha?: string; publishTarget?: string };
  try { body = safeJsonParse(await c.req.raw.text()) as typeof body; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { owner, repo, branch = 'main', path, op, content, fromPath, baseSha, publishTarget } = body;
  if (!areRepoAndPathValid(owner, repo, branch, path)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '参数不合法'), 400);
  }
  if (op !== 'write' && op !== 'delete' && op !== 'move') {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'op 须为 write/delete/move'), 400);
  }
  if (op === 'write') {
    if (typeof content !== 'string') {
      return c.json(error(ErrorCode.VALIDATION_ERROR, 'write 操作需提供 content'), 400);
    }
    if (content.length > MAX_CONTENT_SIZE) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, '文件过大（单文件上限 10MB）'), 400);
    }
  }
  if (op === 'move') {
    if (!fromPath || !isSafePathParam(fromPath, true)) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, 'move 操作需合法 fromPath'), 400);
    }
  }
  if (publishTarget !== undefined && !isSafePathParam(publishTarget, true)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '非法 publishTarget'), 400);
  }
  try {
    // write 未显式携带 publishTarget 时保留原目标，避免再次保存冲掉预发布目录
    let resolvedTarget = publishTarget || undefined;
    if (op === 'write' && publishTarget === undefined) {
      const existing = await readBufferEntry(c.env, owner!, repo!, branch, path!);
      resolvedTarget = existing?.publishTarget;
    }
    await writeBufferEntry(c.env, owner!, repo!, branch, path!, {
      op: op as 'write' | 'delete' | 'move',
      content: op === 'write' ? content : undefined,
      fromPath: op === 'move' ? fromPath : undefined,
      baseSha,
      savedAt: Date.now(),
      publishTarget: resolvedTarget,
    });
    return c.json(success({ path, op }, '已存入缓冲'));
  } catch (err) {
    return respondBufferError(c, err);
  }
});

// DELETE /api/buffer/file?owner&repo&branch&path — 放弃单条缓冲变更
bufferApp.delete('/api/buffer/file', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const branch = c.req.query('branch') || 'main';
  const path = c.req.query('path');
  if (!areRepoAndPathValid(owner, repo, branch, path)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '参数不合法'), 400);
  }
  try {
    await deleteBufferEntry(c.env, owner!, repo!, branch, path!);
    return c.json(success(null, '已放弃该缓冲变更'));
  } catch (err) {
    return respondBufferError(c, err);
  }
});

// GET /api/buffer/changes?owner&repo&branch — 变更清单
bufferApp.get('/api/buffer/changes', async (c: Context<HonoEnv>) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const branch = c.req.query('branch') || 'main';
  if (!areRepoParamsValid(owner, repo, branch)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '参数不合法'), 400);
  }
  try {
    const items = await listBufferChanges(c.env, owner!, repo!, branch);
    return c.json(success({ items, count: items.length }));
  } catch (err) {
    return respondBufferError(c, err);
  }
});

// ---------- 发布 ----------

// POST /api/buffer/publish {owner,repo,branch,userName,items?}
// items 省略 = 全量发布；提供则逐项发布，publishTarget 覆盖该条目标
bufferApp.post('/api/buffer/publish', async (c: Context<HonoEnv>) => {
  let body: { owner?: string; repo?: string; branch?: string; userName?: string; items?: PublishItem[] };
  try { body = safeJsonParse(await c.req.raw.text()) as typeof body; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { owner, repo, branch = 'main', userName, items } = body;
  if (!areRepoParamsValid(owner, repo, branch)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '参数不合法'), 400);
  }
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length > 100) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, 'items 需为数组且不超过 100 项'), 400);
    }
    for (const item of items) {
      if (!item || !isSafePathParam(item.path, true)) {
        return c.json(error(ErrorCode.VALIDATION_ERROR, 'items 中存在非法 path'), 400);
      }
      if (item.publishTarget !== undefined && !isSafePathParam(item.publishTarget, true)) {
        return c.json(error(ErrorCode.VALIDATION_ERROR, 'items 中存在非法 publishTarget'), 400);
      }
    }
  }
  try {
    const result = await publishBuffer(c.env, auth(c).githubToken, owner!, repo!, branch, userName, items);
    return c.json(success(result, result.message));
  } catch (err) {
    return respondBufferError(c, err);
  }
});

// PUT /api/buffer/target {owner,repo,branch,path,publishTarget} — 设置/清除单条发布目标
bufferApp.put('/api/buffer/target', async (c: Context<HonoEnv>) => {
  let body: { owner?: string; repo?: string; branch?: string; path?: string; publishTarget?: string | null };
  try { body = safeJsonParse(await c.req.raw.text()) as typeof body; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { owner, repo, branch = 'main', path, publishTarget } = body;
  if (!areRepoAndPathValid(owner, repo, branch, path)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '参数不合法'), 400);
  }
  if (publishTarget !== null && publishTarget !== undefined && !isSafePathParam(publishTarget, true)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '非法 publishTarget'), 400);
  }
  try {
    const updated = await setBufferPublishTarget(c.env, owner!, repo!, branch, path!, publishTarget ?? null);
    if (!updated) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, '缓冲中不存在该文件'), 404);
    }
    return c.json(success({ path, publishTarget: publishTarget ?? null }, '已设置发布目标'));
  } catch (err) {
    return respondBufferError(c, err);
  }
});

export default bufferApp;
