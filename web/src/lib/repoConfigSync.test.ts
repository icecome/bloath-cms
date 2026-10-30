// repoConfigSync 纯逻辑测试：凭据剥离 + 并行多桶覆盖护栏。
//
// 守护的缺陷（2026-10-30 用户实测反馈）：前端添加 S3 后端保存后，切出页面再回来
// 配置全空白。根因是同步链路只认旧的 media.s3 扁平字段，未兼容 backends 数组：
// 仓库侧旧结构（无 backends）被「仓库为准」直接覆盖，本地 S3 后端配置被清空。
//
// 纯逻辑在 repoConfigSyncPure.ts（零依赖）；本测试只加载该模块，规避 repoConfigSync.ts
// 因 ./api 无后缀 import 导致 node ESM 加载失败（AGENTS.md R10 范式）。
// 运行：node --experimental-strip-types --test-reporter=spec --test src/lib/repoConfigSync.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripLegacyS3Credentials, isSafeToOverwriteMedia } from './repoConfigSyncPure.ts';
import type { MediaConfig } from '../../../shared/types';

/** 构造最小合法 MediaConfig（字段覆盖按需） */
function makeMedia(overrides: Partial<MediaConfig> = {}): MediaConfig {
  return {
    sourceType: 's3',
    imageOwner: '', imageRepo: '', imageBranch: 'main',
    mediaPath: 'assets', imageBranchName: 'assets',
    cdnProvider: 'jsdelivr', customCdnTemplate: '',
    quality: 80, renameTemplate: 'x', duplicateStrategy: 'skip', uploadMode: 'compress',
    backends: [{ id: 's3-abc', kind: 's3', label: 'S3 图床', enabled: true, s3PublicBaseUrl: 'https://img.x.com/{path}' }],
    defaultBackendId: 's3-abc',
    ...overrides,
  };
}

test('stripLegacyS3Credentials：剥离旧扁平 s3 凭据，保留 backends', () => {
  const media = makeMedia({
    s3: { endpoint: 'https://s3.x.com', region: 'auto', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK', prefix: '', publicBaseUrl: '' },
  });
  const out = stripLegacyS3Credentials(media);
  assert.equal(out.s3, undefined, 's3 凭据对象必须被剥掉');
  // 剥离 s3 后 backends 必须原样保留（这是本次修复的核心断言）
  assert.equal(out.backends?.length, 1);
  assert.equal(out.backends?.[0]?.s3PublicBaseUrl, 'https://img.x.com/{path}');
});

test('stripLegacyS3Credentials：无 s3 时原样返回（引用不变，无谓重建）', () => {
  const media = makeMedia();
  assert.equal(stripLegacyS3Credentials(media), media);
});

test('isSafeToOverwriteMedia：非空 backends 允许覆盖', () => {
  assert.equal(isSafeToOverwriteMedia(makeMedia()), true);
  assert.equal(isSafeToOverwriteMedia(makeMedia({ backends: [{ id: 'a', kind: 'standalone', label: 'x', enabled: true }] })), true);
});

test('isSafeToOverwriteMedia：空数组/缺失/非数组一律拒绝覆盖（守护配置丢失缺陷）', () => {
  // 旧版本仓库 config 无 backends 字段：不得用它清空本地
  assert.equal(isSafeToOverwriteMedia(makeMedia({ backends: undefined as unknown as MediaConfig['backends'] })), false);
  // 仓库侧推送了空列表（异常写入）：同样拒绝
  assert.equal(isSafeToOverwriteMedia(makeMedia({ backends: [] })), false);
  // 类型漂移防御：非数组不得覆盖
  assert.equal(isSafeToOverwriteMedia(makeMedia({ backends: 'oops' as unknown as MediaConfig['backends'] })), false);
});
