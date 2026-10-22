// deploy-status 纯函数单元测试（fetchRecentRuns 的网络部分依赖 GitHub，
// 此处锁定状态归一逻辑；徽章文案/配色映射已收敛到 web 侧 DeployBadge，worker 不再重复）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStatus,
  toWorkflowOptions,
} from './deploy-status.ts';
import type { WorkflowInfo } from './github.ts';

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

describe('toWorkflowOptions', () => {
  it('只保留 active 状态的 workflow', () => {
    const workflows = [
      { id: 1, name: 'a', path: '.github/workflows/a.yml', state: 'active' },
      { id: 2, name: 'b', path: '.github/workflows/b.yml', state: 'disabled_manually' },
    ] as WorkflowInfo[];
    const options = toWorkflowOptions(workflows);
    assert.equal(options.length, 1);
    assert.equal(options[0]?.id, 1);
  });
});
