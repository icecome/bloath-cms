// mediaS3Config 多桶分键与 backendId 白名单测试
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBackendId, DEFAULT_BACKEND_ID } from './mediaBackendId.ts';

describe('normalizeBackendId', () => {
  it('空值回退缺省 id', () => {
    assert.equal(normalizeBackendId(undefined), DEFAULT_BACKEND_ID);
    assert.equal(normalizeBackendId(''), DEFAULT_BACKEND_ID);
    assert.equal(normalizeBackendId(null), DEFAULT_BACKEND_ID);
  });

  it('合法 id 原样通过', () => {
    assert.equal(normalizeBackendId('s3-r2'), 's3-r2');
    assert.equal(normalizeBackendId('repo_assets'), 'repo_assets');
    assert.equal(normalizeBackendId('a1'), 'a1');
    assert.equal(normalizeBackendId('  s3-r2  '), 's3-r2'); // 前后空白归一
  });

  it('非法 id 拒绝（防 app_settings 键注入）', () => {
    assert.equal(normalizeBackendId('media_s3_config:evil'), null);
    assert.equal(normalizeBackendId('../x'), null);
    assert.equal(normalizeBackendId('a b'), null);
    assert.equal(normalizeBackendId('中文'), null);
    assert.equal(normalizeBackendId('a'.repeat(65)), null);
  });
});

/** 内存版存储端口（不触网、不依赖真实 D1） */
function memoryStore(): Map<string, string> {
  return new Map<string, string>();
}

/** 把 Map 适配为 s3ConfigStore 的存储端口 */
function portOf(store: Map<string, string>) {
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); },
  };
}

describe('s3ConfigStore 分键存储与历史单桶迁移', () => {
  it('分键隔离：不同 backendId 的配置互不干扰', async () => {
    const { getStoredS3Config, storageKey } = await import('./s3ConfigStore.ts');
    const store = memoryStore();
    await portOf(store).set(storageKey('backend-a'), JSON.stringify({ bucket: 'bucket-a' }));
    await portOf(store).set(storageKey('backend-b'), JSON.stringify({ bucket: 'bucket-b' }));

    const a = await getStoredS3Config(portOf(store), 'backend-a');
    const b = await getStoredS3Config(portOf(store), 'backend-b');
    assert.equal(JSON.parse(a!).bucket, 'bucket-a');
    assert.equal(JSON.parse(b!).bucket, 'bucket-b');
  });

  it('未配置的 backendId 返回 null（不误读其它桶）', async () => {
    const { getStoredS3Config, storageKey } = await import('./s3ConfigStore.ts');
    const store = memoryStore();
    await portOf(store).set(storageKey('backend-a'), JSON.stringify({ bucket: 'bucket-a' }));
    assert.equal(await getStoredS3Config(portOf(store), 'backend-b'), null);
  });

  it('历史单桶键被读路径迁移到缺省分键（原键保留）', async () => {
    const { getStoredS3Config, storageKey, LEGACY_CONFIG_KEY } = await import('./s3ConfigStore.ts');
    const store = memoryStore();
    const legacyValue = JSON.stringify({ bucket: 'legacy-bucket' });
    await portOf(store).set(LEGACY_CONFIG_KEY, legacyValue);

    const cfg = await getStoredS3Config(portOf(store), 'default');
    assert.equal(JSON.parse(cfg!).bucket, 'legacy-bucket');
    assert.ok(store.get(storageKey('default')), '历史键应被拷贝到分键');
    assert.ok(store.get(LEGACY_CONFIG_KEY), '历史键应保留不删（迁移不可逆约定）');
  });

  it('迁移幂等：分键已存在时不再读历史键', async () => {
    const { getStoredS3Config, storageKey, LEGACY_CONFIG_KEY } = await import('./s3ConfigStore.ts');
    const store = memoryStore();
    await portOf(store).set(storageKey('default'), JSON.stringify({ bucket: 'current' }));
    await portOf(store).set(LEGACY_CONFIG_KEY, JSON.stringify({ bucket: 'legacy' }));

    const cfg = await getStoredS3Config(portOf(store), 'default');
    assert.equal(JSON.parse(cfg!).bucket, 'current', '分键优先');
  });

  it('非缺省 backendId 不回退历史单桶键', async () => {
    const { getStoredS3Config, LEGACY_CONFIG_KEY } = await import('./s3ConfigStore.ts');
    const store = memoryStore();
    await portOf(store).set(LEGACY_CONFIG_KEY, JSON.stringify({ bucket: 'legacy' }));
    assert.equal(await getStoredS3Config(portOf(store), 'other-backend'), null);
  });

  it('迁移写失败时仍返回历史键值（不阻断读）', async () => {
    const { getStoredS3Config, LEGACY_CONFIG_KEY } = await import('./s3ConfigStore.ts');
    const store = memoryStore();
    await portOf(store).set(LEGACY_CONFIG_KEY, JSON.stringify({ bucket: 'legacy' }));
    const failingPort = {
      get: async (key: string) => store.get(key) ?? null,
      set: async () => { throw new Error('D1 写入失败'); },
    };
    const cfg = await getStoredS3Config(failingPort, 'default');
    assert.ok(cfg, '迁移失败也应能读到历史键值');
    assert.equal(JSON.parse(cfg!).bucket, 'legacy');
  });
});
