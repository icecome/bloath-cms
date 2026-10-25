// deploy-status 纯函数单元测试（fetchRecentRuns 的网络部分依赖 GitHub，
// 此处锁定状态归一逻辑；徽章文案/配色映射已收敛到 web 侧 DeployBadge，worker 不再重复）
// toWorkflowOptions 已删除（audit m-03）：生产路由用的是 github.ts listWorkflows
// 的内联 filter，本侧那份是「为测试而活」的死代码；active 过滤语义单源在 github.ts。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus } from './deploy-status.ts';

describe('normalizeStatus（GitHub 原始状态归一）', () => {
  it('标准状态逐个映射', () => {
    assert.equal(normalizeStatus('queued'), 'queued');
    assert.equal(normalizeStatus('in_progress'), 'in_progress');
    assert.equal(normalizeStatus('completed'), 'completed');
    assert.equal(normalizeStatus('cancelled'), 'cancelled');
  });

  it('未知/缺失状态兜底为 unknown', () => {
    assert.equal(normalizeStatus('weird_state'), 'unknown');
    assert.equal(normalizeStatus(undefined), 'unknown');
  });
});
