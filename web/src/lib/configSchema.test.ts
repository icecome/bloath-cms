// 配置 Schema 校验单元测试（P3-5 + 并行媒体仓库迁移）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredMediaConfig, DEFAULT_BACKEND_ID, backendFromLegacy } from './configSchema.ts';

const validConfig = {
  sourceType: 'standalone',
  imageOwner: 'a',
  imageRepo: 'b',
  imageBranch: 'main',
  mediaPath: 'assets',
  imageBranchName: 'assets',
  cdnProvider: 'jsdelivr',
  customCdnTemplate: '',
  quality: 80,
  renameTemplate: '{{date:YYYY}}{{date:MM}}{{date:DD}}-{{filename}}',
  duplicateStrategy: 'skip',
  uploadMode: 'compress',
};

const validBackend = {
  id: DEFAULT_BACKEND_ID,
  kind: 'standalone' as const,
  label: '独立图床仓库',
  enabled: true,
  owner: 'a',
  repo: 'b',
  branch: 'main',
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

  // ---- 并行媒体仓库（backends + defaultBackendId） ----

  it('新结构（含 backends）原样通过', () => {
    const parsed = parseStoredMediaConfig({
      ...validConfig,
      backends: [validBackend],
      defaultBackendId: DEFAULT_BACKEND_ID,
    });
    assert.ok(parsed);
    assert.equal(parsed.backends.length, 1);
    assert.equal(parsed.defaultBackendId, DEFAULT_BACKEND_ID);
  });

  it('旧配置（无 backends）自动迁移为单 backend', () => {
    const parsed = parseStoredMediaConfig(validConfig);
    assert.ok(parsed);
    assert.equal(parsed.backends.length, 1);
    assert.equal(parsed.backends[0].kind, 'standalone');
    assert.equal(parsed.backends[0].owner, 'a');
    assert.equal(parsed.backends[0].repo, 'b');
    assert.equal(parsed.defaultBackendId, DEFAULT_BACKEND_ID);
  });

  it('旧 s3 配置迁移保留 publicBaseUrl', () => {
    const parsed = parseStoredMediaConfig({
      ...validConfig,
      sourceType: 's3',
      s3: { endpoint: 'https://s3.x', region: 'auto', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk', prefix: 'img', publicBaseUrl: 'https://cdn.example.com/{path}' },
    });
    assert.ok(parsed);
    assert.equal(parsed.backends.length, 1);
    assert.equal(parsed.backends[0].kind, 's3');
    assert.equal(parsed.backends[0].s3PublicBaseUrl, 'https://cdn.example.com/{path}');
  });

  it('backends 结构非法拒绝', () => {
    assert.equal(parseStoredMediaConfig({
      ...validConfig,
      backends: [{ id: 'x', kind: 'ftp', label: 'bad', enabled: true }],
      defaultBackendId: 'x',
    }), null);
  });

  it('多 backend 并行结构通过', () => {
    const parsed = parseStoredMediaConfig({
      ...validConfig,
      backends: [
        validBackend,
        { id: 's3-r2', kind: 's3', label: 'R2', enabled: true, s3PublicBaseUrl: 'https://r2.example.com/{path}' },
        { id: 'repo-assets', kind: 'repo-dir', label: '仓库子目录', enabled: false, pathPrefix: 'static/images' },
      ],
      defaultBackendId: 's3-r2',
    });
    assert.ok(parsed);
    assert.equal(parsed.backends.length, 3);
    assert.equal(parsed.defaultBackendId, 's3-r2');
  });
});

describe('backendFromLegacy', () => {
  it('各 kind 映射正确', () => {
    assert.equal(backendFromLegacy({ ...validConfig, sourceType: 'standalone' }).kind, 'standalone');
    assert.equal(backendFromLegacy({ ...validConfig, sourceType: 'repo-dir' }).pathPrefix, 'assets');
    assert.equal(backendFromLegacy({ ...validConfig, sourceType: 'image-branch' }).branch, 'assets');
    assert.equal(backendFromLegacy({ ...validConfig, sourceType: 's3' }).s3PublicBaseUrl, '');
  });
});
