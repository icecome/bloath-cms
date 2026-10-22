// S3 兼容图床客户端（P3-2）：复用 aws4fetch SigV4 签名，直接从浏览器上传/列举/删除。
//
// 与 worker 端 s3.client.ts 的关系：同一套协议实现，但运行环境不同（浏览器 vs Workers）——
// 浏览器端无 S3Error 包装层（错误信息直接面向用户），且凭据来自 MediaConfig（localStorage）
// 而非 Worker Env。两端如调整签名语义需同步（见 CODE_REUSE_LOG）。
import { AwsClient } from 'aws4fetch';
import type { S3MediaConfig } from '../../../shared/types';

/** 单个对象条目（媒体库列表用） */
export interface S3MediaEntry {
  key: string;
  size: number;
  lastModified: number;
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function baseUrl(cfg: S3MediaConfig): string {
  return `${cfg.endpoint.replace(/\/+$/, '')}/${cfg.bucket}`;
}

function client(cfg: S3MediaConfig): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region || 'auto',
    service: 's3',
  });
}

/** 上传文本/二进制（base64 已由调用方转 Blob） */
export async function s3PutObject(cfg: S3MediaConfig, key: string, blob: Blob): Promise<void> {
  const aws = client(cfg);
  const res = await aws.fetch(`${baseUrl(cfg)}/${encodeKey(key)}`, {
    method: 'PUT',
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`S3 PutObject 失败（${res.status}）：${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}

export async function s3DeleteObject(cfg: S3MediaConfig, key: string): Promise<void> {
  const aws = client(cfg);
  const res = await aws.fetch(`${baseUrl(cfg)}/${encodeKey(key)}`, { method: 'DELETE' });
  // S3 删除不存在的对象返回 204，幂等
  if (!res.ok && res.status !== 404) {
    throw new Error(`S3 DeleteObject 失败（${res.status}）`);
  }
}

/** 列举前缀下全部对象（分页聚合） */
export async function s3ListObjects(cfg: S3MediaConfig, prefix: string): Promise<S3MediaEntry[]> {
  const aws = client(cfg);
  const entries: S3MediaEntry[] = [];
  let token: string | undefined;
  do {
    const params = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
    if (token) params.set('continuation-token', token);
    const res = await aws.fetch(`${baseUrl(cfg)}?${params}`);
    if (!res.ok) {
      throw new Error(`S3 ListObjects 失败（${res.status}）：${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const xml = await res.text();
    entries.push(...parseListXml(xml));
    const nextMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated && nextMatch ? decodeXml(nextMatch[1] ?? '') : undefined;
  } while (token);
  return entries;
}

/** 由公网基址构造外链 URL；未配置 publicBaseUrl 时返回空串（UI 层降级） */
export function s3PublicUrl(cfg: S3MediaConfig, key: string): string {
  if (!cfg.publicBaseUrl) return '';
  return cfg.publicBaseUrl
    .replace('{bucket}', cfg.bucket)
    .replace('{key}', key.split('/').map(encodeURIComponent).join('/'))
    .replace('{path}', key);
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseListXml(xml: string): S3MediaEntry[] {
  const entries: S3MediaEntry[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1] ?? '';
    const keyM = block.match(/<Key>([^<]+)<\/Key>/);
    if (!keyM) continue;
    const sizeM = block.match(/<Size>(\d+)<\/Size>/);
    const lmM = block.match(/<LastModified>([^<]+)<\/LastModified>/);
    entries.push({
      key: decodeXml(keyM[1] ?? ''),
      size: sizeM ? parseInt(sizeM[1] ?? '0', 10) : 0,
      lastModified: lmM ? new Date(lmM[1] ?? '').getTime() || 0 : 0,
    });
  }
  return entries;
}
