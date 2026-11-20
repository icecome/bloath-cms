// 草稿发布目标构造测试（AGENTS.md §4 铁律 3：零依赖业务逻辑必须配同目录测试）。
//
// 锁死三条已发生事故的失败形态：
//   1. 空目标条目混进发布批次 → 发布对话框出现无目标行
//   2. 同一源文件重复提交 → 第二次因源文件已不存在而报错（双击提交的实际形态）
//   3. 统一目标覆盖用户已做的逐项选择 → 静默数据丢失
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTargetEntries,
  findTargetConflicts,
  describeTargetConflict,
  type DraftTargetEntry,
} from './draftTargets.ts';
import type { EnhancedFileItem } from './extractFrontMatter.ts';

/** 构造最小草稿项（只需 path 参与逻辑，其余字段填默认值） */
function item(path: string): EnhancedFileItem {
  return { name: path.split('/').pop() || path, path, sha: `sha-${path}`, type: 'file' };
}

describe('buildTargetEntries', () => {
  test('正常映射：逐项保留源路径与目标路径', () => {
    const entries = buildTargetEntries(
      [item('.draft/a.md'), item('.draft/b.md')],
      { '.draft/a.md': 'content/posts/a.md', '.draft/b.md': 'content/posts/b.md' }
    );
    assert.equal(entries.length, 2);
    assert.equal(entries[0].item.path, '.draft/a.md');
    assert.equal(entries[0].previewTarget, 'content/posts/a.md');
  });

  test('空目标被剔除（缺失键 / 空串 / 纯空白三种形态）', () => {
    const entries = buildTargetEntries(
      [item('.draft/a.md'), item('.draft/b.md'), item('.draft/c.md')],
      { '.draft/b.md': '', '.draft/c.md': '   ' }
    );
    assert.equal(entries.length, 0, '无目标的条目不进入发布/预发布流程');
  });

  test('目标两端空白被裁掉（粘贴带空格的目标是常见操作）', () => {
    const entries = buildTargetEntries(
      [item('.draft/a.md')],
      { '.draft/a.md': '  content/posts/a.md  ' }
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].previewTarget, 'content/posts/a.md');
  });

  test('同一源路径重复出现时去重，后者覆盖前者', () => {
    const dup: EnhancedFileItem = { ...item('.draft/a.md'), sha: 'sha-new' };
    const entries = buildTargetEntries(
      [item('.draft/a.md'), dup],
      { '.draft/a.md': 'content/x.md' }
    );
    assert.equal(entries.length, 1, '同一源文件不能进批次两次');
    assert.equal(entries[0].item.sha, 'sha-new', '保留最后一次出现的那条');
  });

  test('空输入返回空数组（不抛错）', () => {
    assert.deepEqual(buildTargetEntries([], {}), []);
  });

  test('多个源指向同一目标是允许构造的（冲突由 findTargetConflicts 单独判定）', () => {
    const entries = buildTargetEntries(
      [item('.draft/a.md'), item('.draft/b.md')],
      { '.draft/a.md': 'content/same.md', '.draft/b.md': 'content/same.md' }
    );
    assert.equal(entries.length, 2, '构造阶段不静默丢弃，交给冲突检测显式报错');
  });
});

describe('findTargetConflicts', () => {
  test('无冲突时返回空数组', () => {
    const entries: DraftTargetEntry[] = [
      { item: item('.draft/a.md'), previewTarget: 'content/a.md' },
      { item: item('.draft/b.md'), previewTarget: 'content/b.md' },
    ];
    assert.deepEqual(findTargetConflicts(entries), []);
  });

  test('两个源指向同一目标：报出目标与全部来源', () => {
    const entries: DraftTargetEntry[] = [
      { item: item('.draft/a.md'), previewTarget: 'content/same.md' },
      { item: item('.draft/b.md'), previewTarget: 'content/same.md' },
    ];
    const conflicts = findTargetConflicts(entries);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].target, 'content/same.md');
    assert.deepEqual(conflicts[0].sources.sort(), ['.draft/a.md', '.draft/b.md']);
  });

  test('三源同一目标只报一条冲突（不是 C(3,2) 条）', () => {
    const entries: DraftTargetEntry[] = [
      { item: item('a.md'), previewTarget: 'x.md' },
      { item: item('b.md'), previewTarget: 'x.md' },
      { item: item('c.md'), previewTarget: 'x.md' },
    ];
    const conflicts = findTargetConflicts(entries);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].sources.length, 3);
  });

  test('多组冲突各自成条', () => {
    const entries: DraftTargetEntry[] = [
      { item: item('a.md'), previewTarget: 'x.md' },
      { item: item('b.md'), previewTarget: 'x.md' },
      { item: item('c.md'), previewTarget: 'y.md' },
      { item: item('d.md'), previewTarget: 'y.md' },
    ];
    const conflicts = findTargetConflicts(entries);
    assert.equal(conflicts.length, 2);
    assert.deepEqual(conflicts.map((c) => c.target).sort(), ['x.md', 'y.md']);
  });

  test('空数组不抛错', () => {
    assert.deepEqual(findTargetConflicts([]), []);
  });
});

describe('describeTargetConflict', () => {
  test('无冲突返回 null（调用方据此判断是否拦截）', () => {
    assert.equal(describeTargetConflict([]), null);
  });

  test('单组冲突：提示含目标路径、牵涉篇数与恢复方式', () => {
    const message = describeTargetConflict([
      { target: 'content/same.md', sources: ['a.md', 'b.md'] },
    ]);
    assert.ok(message, '有冲突必须返回文案');
    assert.ok(message.includes('content/same.md'), '必须点明重复的目标');
    assert.ok(message.includes('2 篇草稿'), '必须说明牵涉篇数');
    assert.ok(message.includes('指定不同目标'), '必须给出恢复方式');
    assert.ok(!message.includes('另有'), '单组冲突不加后缀');
  });

  test('多组冲突：补一句「另有 N 组」而不是把全部路径堆进 toast', () => {
    const message = describeTargetConflict([
      { target: 'x.md', sources: ['a.md', 'b.md'] },
      { target: 'y.md', sources: ['c.md', 'd.md'] },
    ]);
    assert.ok(message);
    assert.ok(message.includes('另有 1 组重复'), '多组冲突给出总数提示');
  });

  test('三源同一目标：篇数按 3 计', () => {
    const message = describeTargetConflict([{ target: 'x.md', sources: ['a.md', 'b.md', 'c.md'] }]);
    assert.ok(message?.includes('3 篇草稿'));
  });
});
