// S3 兼容存储客户端（aws4fetch SigV4 签名）
// 路径风格 URL：{endpoint}/{bucket}/{key}，对 MinIO/R2/OSS 网关通用
import { AwsClient } from 'aws4fetch';
import type { BufferConfig } from './bufferConfig.service';
import { S3Error } from './s3.errors';

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function baseUrl(cfg: BufferConfig): string {
  return `${cfg.endpoint}/${cfg.bucket}`;
}

function client(cfg: BufferConfig): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region || 'auto',
    service: 's3',
  });
}

export async function putObject(cfg: BufferConfig, key: string, body: string): Promise<void> {
  const aws = client(cfg);
  const res = await aws.fetch(`${baseUrl(cfg)}/${encodeKey(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new S3Error('PutObject', res.status, text);
  }
}

export async function getObject(cfg: BufferConfig, key: string): Promise<string | null> {
  const aws = client(cfg);
  const res = await aws.fetch(`${baseUrl(cfg)}/${encodeKey(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new S3Error('GetObject', res.status, text);
  }
  return res.text();
}

export async function deleteObject(cfg: BufferConfig, key: string): Promise<void> {
  const aws = client(cfg);
  const res = await aws.fetch(`${baseUrl(cfg)}/${encodeKey(key)}`, { method: 'DELETE' });
  // S3 删除不存在的对象返回 204，幂等
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new S3Error('DeleteObject', res.status, text);
  }
}

export interface S3ListEntry {
  key: string;
  size: number;
  lastModified: string;
}

export async function listObjects(cfg: BufferConfig, prefix: string): Promise<S3ListEntry[]> {
  const aws = client(cfg);
  const entries: S3ListEntry[] = [];
  let token: string | undefined;
  do {
    const params = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
    if (token) params.set('continuation-token', token);
    const res = await aws.fetch(`${baseUrl(cfg)}?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new S3Error('ListObjects', res.status, text);
    }
    const xml = await res.text();
    entries.push(...parseListXml(xml));
    const nextMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated && nextMatch ? decodeXml(nextMatch[1]) : undefined;
  } while (token);
  return entries;
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseListXml(xml: string): S3ListEntry[] {
  const entries: S3ListEntry[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const keyM = block.match(/<Key>([^<]+)<\/Key>/);
    if (!keyM) continue;
    const sizeM = block.match(/<Size>(\d+)<\/Size>/);
    const lmM = block.match(/<LastModified>([^<]+)<\/LastModified>/);
    entries.push({
      key: decodeXml(keyM[1]),
      size: sizeM ? parseInt(sizeM[1], 10) : 0,
      lastModified: lmM ? decodeXml(lmM[1]) : '',
    });
  }
  return entries;
}
