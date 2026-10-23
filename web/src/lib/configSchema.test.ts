// 配置 Schema 校验单元测试（P3-5）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredMediaConfig } from './configSchema.ts';

const validConfig = {
  sourceType: 'standalone',
  imageOwner: 'a',
  imageRepo: 'b',
  imageBranch: 'main',
  mediaPath: 'assets',
  imageBranchName: 'assets',
  cdnProvider: 'jsdmirror',
  customCdnTemplate: '',
  quality: 80,
  renameTemplate: '{{date:YYYY}}{{date:MM}}{{date:DD}}-{{filename}}',
  duplicateStrategy: 'skip',
  uploadMode: 'compress',
};

describe('parseStoredMediaConfig', () => {
  it('合法配置原样通过', () => {
    const parsed = parseStoredMediaConfig(validConfig);
    assert.ok(parsed);
    assert.equal(parsed.quality, 80);
  });

  it('quality 越界（<10 或 >100）拒绝', () => {
    assert.equal(parseStoredMediaConfig({ ...validConfig, quality: 5 }), null);
    assert.equal(parseStoredMediaConfig({ ...validConfig, quality: 150 }), null);
  });

  it('quality 类型漂移（字符串）拒绝', () => {
    assert.equal(parseStoredMediaConfig({ ...validConfig, quality: '80' }), null);
  });

  it('sourceType 未知值拒绝', () => {
    assert.equal(parseStoredMediaConfig({ ...validConfig, sourceType: 'ftp' }), null);
  });

  it('s3 子对象可选且完整校验', () => {
    const withS3 = { ...validConfig, sourceType: 's3', s3: { endpoint: 'https://s3.x', region: 'auto', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk', prefix: '', publicBaseUrl: '' } };
    assert.ok(parseStoredMediaConfig(withS3));
  });
});
