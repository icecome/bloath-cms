// s3PublicUrl 外链拼接测试：多桶 backendId 追加 + 非代理基址不受影响
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { s3PublicUrl } from './s3MediaClient.ts';
import type { S3MediaSourceView } from './s3MediaClient.ts';

describe('s3PublicUrl', () => {
  it('未配置 publicBaseUrl 返回空串', () => {
    assert.equal(s3PublicUrl({ publicBaseUrl: '' }, 'a.webp'), '');
  });

  it('{path} 占位符替换', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'https://cdn.example.com/{path}' };
    assert.equal(s3PublicUrl(cfg, 'assets/a.webp'), 'https://cdn.example.com/assets/a.webp');
  });

  it('{key} 占位符替换（逐段编码）', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'https://cdn.example.com/{key}' };
    assert.equal(s3PublicUrl(cfg, 'assets/a b.webp'), 'https://cdn.example.com/assets/a%20b.webp');
  });

  it('{bucket} 占位符替换为空串', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'https://{bucket}.cos.example.com/{path}' };
    assert.equal(s3PublicUrl(cfg, 'a.webp'), 'https://.cos.example.com/a.webp');
  });

  it('backendId=default 不追加参数（与 Worker 缺省一致）', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'https://cdn.example.com/{path}', backendId: 'default' };
    assert.equal(s3PublicUrl(cfg, 'a.webp'), 'https://cdn.example.com/a.webp');
  });

  it('backendId 非 default 追加 query 参数（多桶私读定位）', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'https://worker.example.com/media-file/{path}', backendId: 's3-r2' };
    assert.equal(s3PublicUrl(cfg, 'assets/a.webp'), 'https://worker.example.com/media-file/assets/a.webp?backendId=s3-r2');
  });

  it('backendId 含特殊字符时正确百分号编码', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'https://worker.example.com/media-file/{path}', backendId: 'bucket a&b' };
    assert.equal(s3PublicUrl(cfg, 'a.webp'), 'https://worker.example.com/media-file/a.webp?backendId=bucket+a%26b');
  });

  it('非 http(s) 基址不追加参数（非法基址原样返回）', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'not-a-url/{path}', backendId: 's3-r2' };
    assert.equal(s3PublicUrl(cfg, 'a.webp'), 'not-a-url/a.webp');
  });

  it('未传 backendId 不追加参数', () => {
    const cfg: S3MediaSourceView = { publicBaseUrl: 'https://cdn.example.com/{path}' };
    assert.equal(s3PublicUrl(cfg, 'a.webp'), 'https://cdn.example.com/a.webp');
  });
});
