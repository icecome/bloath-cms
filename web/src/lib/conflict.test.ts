// 冲突检测单元测试
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import { assessConflict, checkConflictBeforeSave } from './conflict.ts';

describe('assessConflict（纯函数判定）', () => {
  it('baseSha 为空（新建/缓冲文件）→ 无冲突', () => {
    const result = assessConflict('', 'sha-other');
    assert.equal(result.conflicted, false);
  });

  it('远端 sha 与基线一致 → 无冲突', () => {
    const result = assessConflict('sha-1', 'sha-1');
    assert.equal(result.conflicted, false);
  });

  it('远端 sha 变化 → modified 冲突，携带远端 sha', () => {
    const result = assessConflict('sha-1', 'sha-2');
    assert.equal(result.conflicted, true);
    assert.equal(result.kind, 'modified');
    assert.equal(result.remoteSha, 'sha-2');
  });

  it('远端 404（null）→ deleted 冲突', () => {
    const result = assessConflict('sha-1', null);
    assert.equal(result.conflicted, true);
    assert.equal(result.kind, 'deleted');
  });
});

describe('checkConflictBeforeSave（含读取通道）', () => {
  const repo = { owner: 'a', repo: 'b', branch: 'main' };

  it('baseSha 为空时不发起网络请求', async () => {
    let called = 0;
    const result = await checkConflictBeforeSave(
      async () => {
        called++;
        return { sha: 'x' };
      },
      { repo, path: 'p.md', baseSha: '' }
    );
    assert.equal(called, 0);
    assert.equal(result.conflicted, false);
  });

  it('远端读取成功且一致 → 无冲突', async () => {
    const result = await checkConflictBeforeSave(
      async () => ({ sha: 'sha-1' }),
      { repo, path: 'p.md', baseSha: 'sha-1' }
    );
    assert.equal(result.conflicted, false);
  });

  it('远端读取成功但不一致 → modified', async () => {
    const result = await checkConflictBeforeSave(
      async () => ({ sha: 'sha-9' }),
      { repo, path: 'p.md', baseSha: 'sha-1' }
    );
    assert.equal(result.conflicted, true);
    assert.equal(result.kind, 'modified');
    assert.equal(result.remoteSha, 'sha-9');
  });

  it('读取抛 404（HttpError.status=404）→ deleted', async () => {
    const result = await checkConflictBeforeSave(
      async () => {
        throw new HttpError(404, '未找到');
      },
      { repo, path: 'p.md', baseSha: 'sha-1' }
    );
    assert.equal(result.conflicted, true);
    assert.equal(result.kind, 'deleted');
  });

  it('读取抛网络错误 → 放行（无冲突，由提交时 409 兜底）', async () => {
    const result = await checkConflictBeforeSave(
      async () => {
        throw new Error('network down');
      },
      { repo, path: 'p.md', baseSha: 'sha-1' }
    );
    assert.equal(result.conflicted, false);
  });
});
