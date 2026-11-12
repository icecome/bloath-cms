// 配置 Schema 校验单元测试（P3-5 + 并行媒体仓库迁移）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredMediaConfig, pruneLegacyMediaFields, DEFAULT_BACKEND_ID, backendFromLegacy } from './configSchema.ts';

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

describe('s3 外链配置校验（P1-001 后的类型收窄）', () => {
  it('只有 publicBaseUrl 的最小对象可通过（与 shared/types.ts 的 S3MediaConfig 一致）', () => {
    const parsed = parseStoredMediaConfig({
      ...validConfig,
      s3: { publicBaseUrl: 'https://cdn.example.com/{path}' },
    });
    assert.ok(parsed, '当前类型的合法形态不得被拒绝');
    assert.equal(parsed.s3?.publicBaseUrl, 'https://cdn.example.com/{path}');
  });

  it('历史遗留的完整凭据对象仍可通过（不得因多出键而整份回退默认值）', () => {
    const parsed = parseStoredMediaConfig({
      ...validConfig,
      s3: {
        endpoint: 'https://s3.x', region: 'auto', bucket: 'b',
        accessKeyId: 'ak', secretAccessKey: 'sk', prefix: 'img',
        publicBaseUrl: 'https://cdn.example.com/{path}',
      },
    });
    assert.ok(parsed, '旧数据必须能读出来，否则用户已配好的外链会静默丢失');
    assert.equal(parsed.s3?.publicBaseUrl, 'https://cdn.example.com/{path}');
  });

  it('publicBaseUrl 类型漂移（数字）拒绝', () => {
    assert.equal(
      parseStoredMediaConfig({ ...validConfig, s3: { publicBaseUrl: 123 } }),
      null
    );
  });
});

describe('pruneLegacyMediaFields（双真相收敛）', () => {
  const full: Record<string, unknown> = {
    sourceType: 'standalone',
    imageOwner: 'a',
    imageRepo: 'b',
    imageBranch: 'main',
    mediaPath: 'assets',
    imageBranchName: 'assets',
    cdnProvider: 'jsdelivr',
    customCdnTemplate: '',
    quality: 80,
    renameTemplate: 'x',
    duplicateStrategy: 'skip',
    uploadMode: 'compress',
    backends: [validBackend],
    defaultBackendId: DEFAULT_BACKEND_ID,
  };

  it('剥掉全部 6 个迁移源字段', () => {
    const parsed = parseStoredMediaConfig(full);
    assert.ok(parsed);
    const pruned = pruneLegacyMediaFields(parsed) as Record<string, unknown>;
    for (const field of ['sourceType', 'imageOwner', 'imageRepo', 'imageBranch', 'mediaPath', 'imageBranchName']) {
      assert.equal(field in pruned, false, `${field} 不得留在写回对象里`);
    }
  });

  it('保留运行时权威字段（backends / defaultBackendId / 渲染配置）', () => {
    const parsed = parseStoredMediaConfig(full);
    assert.ok(parsed);
    const pruned = pruneLegacyMediaFields(parsed);
    assert.equal(pruned.backends.length, 1);
    assert.equal(pruned.defaultBackendId, DEFAULT_BACKEND_ID);
    assert.equal(pruned.quality, 80);
    assert.equal(pruned.cdnProvider, 'jsdelivr');
  });

  it('s3 只保留 publicBaseUrl（凭据不落浏览器存储）', () => {
    const parsed = parseStoredMediaConfig({
      ...full,
      s3: {
        endpoint: 'https://s3.x', region: 'auto', bucket: 'b',
        accessKeyId: 'AK', secretAccessKey: 'SK', prefix: 'img',
        publicBaseUrl: 'https://cdn.example.com/{path}',
      },
    });
    assert.ok(parsed);
    const pruned = pruneLegacyMediaFields(parsed);
    assert.deepEqual(pruned.s3, { publicBaseUrl: 'https://cdn.example.com/{path}' });
  });

  it('不修改入参（纯函数）', () => {
    const parsed = parseStoredMediaConfig(full);
    assert.ok(parsed);
    const before = JSON.stringify(parsed);
    pruneLegacyMediaFields(parsed);
    assert.equal(JSON.stringify(parsed), before, '入参必须保持不变');
  });

  it('幂等：连续剥两次结果一致', () => {
    const parsed = parseStoredMediaConfig(full);
    assert.ok(parsed);
    const once = pruneLegacyMediaFields(parsed);
    const twice = pruneLegacyMediaFields(once);
    assert.deepEqual(twice, once);
  });
});

describe('backends 为空时的兜底', () => {
  it('结构合法但 backends 为空：补一个默认 backend，不留空列表给下游', () => {
    const parsed = parseStoredMediaConfig({
      ...validConfig,
      backends: [],
      defaultBackendId: DEFAULT_BACKEND_ID,
    });
    assert.ok(parsed);
    assert.equal(parsed.backends.length, 1, '下游不得处理空 backends');
    assert.equal(parsed.defaultBackendId, DEFAULT_BACKEND_ID);
  });
});
