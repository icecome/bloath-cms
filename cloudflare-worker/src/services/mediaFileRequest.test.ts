// mediaFileRequest 解析测试：多桶 backendId 定位 + 路径取 key + 安全校验
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaFileRequest, ROUTE_PREFIX } from './mediaFileRequest.ts';

describe('parseMediaFileRequest', () => {
  it('未传 backendId 回退 default', () => {
    const r = parseMediaFileRequest('/media-file/assets/a.webp');
    assert.deepEqual(r, { ok: true, backendId: 'default', key: 'assets/a.webp' });
  });

  it('显式 backendId 定位多桶', () => {
    const r = parseMediaFileRequest('/media-file/assets/a.webp', 's3-r2');
    assert.deepEqual(r, { ok: true, backendId: 's3-r2', key: 'assets/a.webp' });
  });

  it('多段 key 正确解出（不把首段误认为 backendId）', () => {
    const r = parseMediaFileRequest('/media-file/assets/2026/10/a.webp', 'bucket2');
    assert.deepEqual(r, { ok: true, backendId: 'bucket2', key: 'assets/2026/10/a.webp' });
  });

  it('默认后端 + 多段 key：key 完整保留', () => {
    const r = parseMediaFileRequest('/media-file/assets/2026/10/a.webp');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.key, 'assets/2026/10/a.webp');
  });

  it('百分号编码的中文 key 正确解码', () => {
    const r = parseMediaFileRequest('/media-file/assets/%E5%9B%BE.webp');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.key, 'assets/图.webp');
  });

  it('解码后含空格的 key 被白名单拒绝（既有安全策略，非本次引入）', () => {
    // PATH_SAFE_PATTERN 不含空格：上传管线已用 sanitizeMediaFileName 清洗文件名，
    // 故落盘 key 不会含空格；此处如实锁定该拒绝行为。
    assert.deepEqual(
      parseMediaFileRequest('/media-file/assets/a%20b.webp'),
      { ok: false, reason: 'invalid-key' }
    );
  });

  it('非法 backendId 拒绝（防共享表键注入）', () => {
    assert.deepEqual(parseMediaFileRequest('/media-file/a.webp', '../evil'), { ok: false, reason: 'invalid-backend-id' });
    assert.deepEqual(parseMediaFileRequest('/media-file/a.webp', 'a b'), { ok: false, reason: 'invalid-backend-id' });
  });

  it('路径遍历 key 拒绝', () => {
    assert.deepEqual(parseMediaFileRequest('/media-file/../secret', 's3-r2'), { ok: false, reason: 'invalid-key' });
  });

  it('空 key 拒绝', () => {
    assert.deepEqual(parseMediaFileRequest('/media-file/'), { ok: false, reason: 'invalid-key' });
  });

  it('非法百分号序列按 invalid-key 拒绝（不抛错）', () => {
    const r = parseMediaFileRequest('/media-file/a%2.webp');
    assert.equal(r.ok, false);
  });

  it('ROUTE_PREFIX 与路由注册一致', () => {
    assert.equal(ROUTE_PREFIX, '/media-file/');
  });
});
