// requestTimeouts 单测：锁死线性放大公式与 getTree 双档超时
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  UPLOAD_TIMEOUT_BASE_MS,
  UPLOAD_TIMEOUT_MAX_MS,
  UPLOAD_TIMEOUT_PER_MB_MS,
  uploadTimeoutMs,
  treeTimeoutMs,
  TREE_FILENAME_TIMEOUT_MS,
  TREE_PLAIN_TIMEOUT_MS,
} from './requestTimeouts.ts';

const MB = 1024 * 1024;

describe('uploadTimeoutMs', () => {
  it('基准：0 字节 = 30s', () => {
    assert.equal(uploadTimeoutMs(0), UPLOAD_TIMEOUT_BASE_MS);
  });

  it('线性：每 MB 加 6s', () => {
    assert.equal(uploadTimeoutMs(1 * MB), UPLOAD_TIMEOUT_BASE_MS + UPLOAD_TIMEOUT_PER_MB_MS);
    assert.equal(uploadTimeoutMs(15 * MB), UPLOAD_TIMEOUT_BASE_MS + 15 * UPLOAD_TIMEOUT_PER_MB_MS);
  });

  it('上限封顶 900s（150MB 视频不再无限放大）', () => {
    assert.equal(uploadTimeoutMs(200 * MB), UPLOAD_TIMEOUT_MAX_MS);
  });

  it('非有限值 / 负数按 0 处理（不产生 NaN 或 Infinity 超时）', () => {
    assert.equal(uploadTimeoutMs(Number.NaN), UPLOAD_TIMEOUT_BASE_MS);
    assert.equal(uploadTimeoutMs(-5), UPLOAD_TIMEOUT_BASE_MS);
    // Infinity 也必须落回基准：setTimeout(fn, Infinity) 会即时触发，比 NaN 更危险
    assert.equal(uploadTimeoutMs(Number.POSITIVE_INFINITY), UPLOAD_TIMEOUT_BASE_MS);
  });

  it('回归锁：10MB 合成成品必须 ≥ 90s（2026-11-02 事故：2s/MB 预算不足）', () => {
    assert.ok(uploadTimeoutMs(10 * MB) >= 90_000);
  });
});

describe('treeTimeoutMs', () => {
  it('plain 模式维持默认 10s（不扇出 commits）', () => {
    assert.equal(treeTimeoutMs(), TREE_PLAIN_TIMEOUT_MS);
    assert.equal(treeTimeoutMs(undefined), 10_000);
  });

  it('filename 模式放宽到 35s（Worker 扇出面）', () => {
    assert.equal(treeTimeoutMs('filename'), TREE_FILENAME_TIMEOUT_MS);
    assert.ok(TREE_FILENAME_TIMEOUT_MS > 15_000, '必须高于 worker 单个子请求超时上限');
  });
});
