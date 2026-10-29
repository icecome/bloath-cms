// 媒体库 S3 代理路由：浏览器不再持有 S3 凭据（P1-001），所有对象存储操作
// 经本路由以 Worker 侧加密存储的凭据执行。
//
// 端点：
//   GET  /api/media/s3/config          脱敏配置（AK 打码，secret 不回传）
//   PUT  /api/media/s3/config          保存（secret 留空沿用；endpoint 过 SSRF 守卫）
//   DELETE /api/media/s3/config        清除配置（前端切走 S3 源时调用）
//   POST /api/media/s3/config/test     连接测试（PutObject 写 .keep 探针，同 buffer 模式）
//   GET  /api/media/s3/objects         列举（ListObjectsV2，prefix 下）
//   PUT  /api/media/s3/objects?key=    上传二进制（body 原始字节，上限同媒体二进制端点）
//   DELETE /api/media/s3/objects?key=  删除
//
// 复用 buffer 的 s3.client（SigV4）与 SSRF 守卫；MediaS3Config 与 BufferConfig
// 结构同形（endpoint/region/bucket/accessKeyId/secretAccessKey/prefix），可直接传入。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../lib/error-codes';
import { success, error } from '../lib/response';
import { requireAuth, type AuthResult } from '../middleware/sessionAuth';
import { writeLimitAfterAuth } from '../middleware/writeLimit';
import { isSafePathParam, safeJsonParse, MAX_MEDIA_BINARY_SIZE } from '../middleware/pathGuard';
import {
  getMediaS3Config, getMediaS3ConfigPublic, saveMediaS3Config, deleteMediaS3Config,
  MissingSecretError,
  type MediaS3ConfigInput,
} from '../services/mediaS3Config.service';
import { putObject, getObject, deleteObject, listObjects } from '../services/s3.client';
import { isBlockedS3Endpoint, S3Error } from '../services/s3.errors';

const mediaS3App = new Hono<HonoEnv>();
mediaS3App.use('/api/media/s3/*', requireAuth);
// 限流必须挂在 requireAuth 之后：key 依赖 auth 中的 githubLogin（见 writeLimit.ts 头注释）
mediaS3App.use('/api/media/s3/*', writeLimitAfterAuth);

function auth(c: Context<HonoEnv>): AuthResult {
  return c.get('auth') as AuthResult;
}

function respondError(c: Context<HonoEnv>, err: unknown) {
  if (err instanceof S3Error) {
    // S3 原始响应体只进日志，不回传客户端（同 buffer 路由约定）
    console.error(`[mediaS3] ${err.op} ${err.status}:`, err.detail);
    return c.json(error(ErrorCode.INTERNAL_ERROR, `对象存储操作失败（${err.status}）`), 502);
  }
  console.error('[mediaS3] 未预期异常：', err);
  return c.json(error(ErrorCode.INTERNAL_ERROR, '服务器内部错误'), 500);
}

// GET /api/media/s3/config
mediaS3App.get('/api/media/s3/config', async (c: Context<HonoEnv>) => {
  const cfg = await getMediaS3ConfigPublic(c.env);
  return c.json(success(cfg));
});

// PUT /api/media/s3/config
mediaS3App.put('/api/media/s3/config', async (c: Context<HonoEnv>) => {
  let body: Partial<MediaS3ConfigInput>;
  try { body = safeJsonParse(await c.req.raw.text()) as Partial<MediaS3ConfigInput>; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, prefix } = body;
  if (!endpoint || !bucket || !accessKeyId) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'endpoint、bucket 与 accessKeyId 不能为空'), 400);
  }
  if (!/^https?:\/\//.test(endpoint) || isBlockedS3Endpoint(endpoint)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'endpoint 须为公网 http(s) URL，不允许内网或本机地址'), 400);
  }
  try {
    await saveMediaS3Config(c.env, {
      endpoint, region, bucket, accessKeyId,
      secretAccessKey: secretAccessKey || '',
      prefix: prefix || '',
    });
    // 保存后用实际动作探测（PutObject 写 .keep）：与 buffer 的「测试连接」一致，
    // HeadBucket 对对象级权限凭证会误判
    const cfg = await getMediaS3Config(c.env);
    if (cfg) {
      const probeKey = `${cfg.prefix ? cfg.prefix + '/' : ''}.keep`;
      await putObject(cfg, probeKey, '');
    }
    return c.json(success(null, '媒体图床配置已保存'));
  } catch (err) {
    // 按错误类型识别「首次保存缺密钥」（audit m-02）：文本匹配 message 会在
    // 文案改动后静默失效，违反 AGENTS.md「禁止 err.message 文本匹配」约定
    if (err instanceof MissingSecretError) {
      return c.json(error(ErrorCode.VALIDATION_ERROR, '首次保存须提供 secretAccessKey'), 400);
    }
    if (err instanceof S3Error) {
      console.error(`[mediaS3] 连接探测失败 ${err.op} ${err.status}:`, err.detail);
      // 405 属方法层拒绝（先于签名校验）：多为 endpoint 填了 CDN/静态网站域名或网关不支持写入
      const hint =
        err.status === 405
          ? '；405 表示写入被网关拒绝——endpoint 若为 CDN/静态网站域名（仅允许 GET）或非 S3 协议服务会这样，请改用 S3 API 端点'
          : '';
      return c.json(
        error(ErrorCode.VALIDATION_ERROR, `配置已保存，但连接探测失败（${err.status}），请检查凭据与权限${hint}`),
        400,
      );
    }
    return respondError(c, err);
  }
});

// DELETE /api/media/s3/config
mediaS3App.delete('/api/media/s3/config', async (c: Context<HonoEnv>) => {
  try {
    await deleteMediaS3Config(c.env);
    return c.json(success(null, '媒体图床配置已清除'));
  } catch (err) {
    return respondError(c, err);
  }
});

// POST /api/media/s3/config/test
mediaS3App.post('/api/media/s3/config/test', async (c: Context<HonoEnv>) => {
  let body: Partial<MediaS3ConfigInput>;
  try { body = safeJsonParse(await c.req.raw.text()) as Partial<MediaS3ConfigInput>; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, prefix } = body;
  if (!endpoint || !bucket || !accessKeyId) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'endpoint、bucket 与 accessKeyId 不能为空'), 400);
  }
  if (!/^https?:\/\//.test(endpoint) || isBlockedS3Endpoint(endpoint)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'endpoint 不允许内网或本机地址'), 400);
  }
  let secret = secretAccessKey || '';
  if (!secret) {
    // 留空沿用已存密钥
    const existing = await getMediaS3Config(c.env);
    if (!existing) return c.json(error(ErrorCode.VALIDATION_ERROR, '缺少 secretAccessKey'), 400);
    secret = existing.secretAccessKey;
    if (!endpoint && !bucket && !accessKeyId) {
      return c.json(success({ ok: true }, '连接成功'));
    }
  }
  try {
    const probeKey = `${prefix || ''}${prefix ? '/' : ''}.keep`;
    await putObject(
      { endpoint: endpoint.replace(/\/+$/, ''), region: region || 'auto', bucket, accessKeyId, secretAccessKey: secret },
      probeKey, ''
    );
    return c.json(success({ ok: true }, '连接成功'));
  } catch (err) {
    // 同 PUT /config 探测：405 是方法层拒绝，指向 endpoint 选错而非凭据
    const hint =
      err instanceof S3Error && err.status === 405
        ? '（405：endpoint 若为 CDN/静态网站域名会拒绝写入，请使用 S3 API 端点）'
        : '';
    const msg =
      err instanceof S3Error ? err.message + hint : `连接异常：${(err as Error).message}`;
    return c.json(error(ErrorCode.VALIDATION_ERROR, msg), 400);
  }
});

// GET /api/media/s3/objects?prefix=
mediaS3App.get('/api/media/s3/objects', async (c: Context<HonoEnv>) => {
  const cfg = await getMediaS3Config(c.env);
  if (!cfg) return c.json(error(ErrorCode.VALIDATION_ERROR, '媒体图床未配置'), 400);
  const prefix = c.req.query('prefix') || '';
  try {
    const entries = await listObjects(cfg, prefix);
    return c.json(success(entries));
  } catch (err) {
    return respondError(c, err);
  }
});

// PUT /api/media/s3/objects?key=&contentType= — 上传二进制
mediaS3App.put('/api/media/s3/objects', async (c: Context<HonoEnv>) => {
  const cfg = await getMediaS3Config(c.env);
  if (!cfg) return c.json(error(ErrorCode.VALIDATION_ERROR, '媒体图床未配置'), 400);
  const key = c.req.query('key') || '';
  if (!isSafePathParam(key, true)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'key 参数无效'), 400);
  }
  const bytes = await c.req.raw.arrayBuffer();
  if (bytes.byteLength === 0) return c.json(error(ErrorCode.VALIDATION_ERROR, '空文件'), 400);
  if (bytes.byteLength > MAX_MEDIA_BINARY_SIZE) {
    return c.json(error(ErrorCode.PAYLOAD_TOO_LARGE, `文件超过 ${MAX_MEDIA_BINARY_SIZE / 1048576} MB 上限`), 413);
  }
  const fullPath = cfg.prefix ? `${cfg.prefix}/${key}` : key;
  try {
    await putObject(cfg, fullPath, bytes, c.req.query('contentType') || 'application/octet-stream');
    return c.json(success({ key: fullPath }));
  } catch (err) {
    return respondError(c, err);
  }
});

// DELETE /api/media/s3/objects?key=
mediaS3App.delete('/api/media/s3/objects', async (c: Context<HonoEnv>) => {
  const cfg = await getMediaS3Config(c.env);
  if (!cfg) return c.json(error(ErrorCode.VALIDATION_ERROR, '媒体图床未配置'), 400);
  const key = c.req.query('key') || '';
  if (!isSafePathParam(key, true)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, 'key 参数无效'), 400);
  }
  const fullPath = cfg.prefix ? `${cfg.prefix}/${key}` : key;
  try {
    await deleteObject(cfg, fullPath);
    return c.json(success(null));
  } catch (err) {
    return respondError(c, err);
  }
});

export default mediaS3App;
