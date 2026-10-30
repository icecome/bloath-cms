// computeShiftRange 单测：锚点以 path 记录、区间按当前列表位置计算。
//
// 重点覆盖「筛选导致索引失效」的场景——这正是从数组索引锚点改为 path 锚点的原因。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeShiftRange } from './selectionRange.ts';

function items(...paths: string[]) {
  return paths.map((path) => ({ path }));
}

describe('computeShiftRange —— 基本区间', () => {
  it('向前扩选：anchor 在 target 之前', () => {
    const list = items('a', 'b', 'c', 'd', 'e');
    assert.deepEqual(computeShiftRange(list, 'b', 'd'), ['b', 'c', 'd']);
  });

  it('向后扩选：anchor 在 target 之后（反向）', () => {
    const list = items('a', 'b', 'c', 'd', 'e');
    assert.deepEqual(computeShiftRange(list, 'd', 'b'), ['b', 'c', 'd']);
  });

  it('锚点与目标相同：返回单元素，不产生空区间', () => {
    const list = items('a', 'b', 'c');
    assert.deepEqual(computeShiftRange(list, 'b', 'b'), ['b']);
  });

  it('首尾区间：覆盖整个列表', () => {
    const list = items('a', 'b', 'c');
    assert.deepEqual(computeShiftRange(list, 'a', 'c'), ['a', 'b', 'c']);
  });
});

describe('computeShiftRange —— 无效输入', () => {
  it('无锚点（首次点击）→ null', () => {
    assert.equal(computeShiftRange(items('a', 'b'), null, 'b'), null);
  });

  it('锚点被筛选掉 → null', () => {
    const list = items('a', 'c', 'd');
    assert.equal(computeShiftRange(list, 'b', 'c'), null);
  });

  it('目标不在列表中 → null', () => {
    const list = items('a', 'b', 'c');
    assert.equal(computeShiftRange(list, 'a', 'zzz'), null);
  });
});

describe('computeShiftRange —— 筛选后索引错位（核心回归）', () => {
  it('筛选导致列表缩短后，锚点仍指向原条目而非同名索引', () => {
    const full = items('a', 'b', 'c', 'd', 'e', 'f', 'g');
    // 用户在完整列表点击 'f'（索引 5）作为锚点
    const anchorPath = full[5]?.path ?? '';
    assert.equal(anchorPath, 'f');

    // 随后输入筛选词，列表只剩 3 项。若锚点存的是索引 5，findIndex 会 -1 或越界；
    // 存 path 则能正确定位到新列表中的 'f'。
    const filtered = items('a', 'f', 'g');
    assert.deepEqual(computeShiftRange(filtered, anchorPath, 'a'), ['a', 'f']);
    assert.deepEqual(computeShiftRange(filtered, anchorPath, 'g'), ['f', 'g']);
  });

  it('筛选重排后区间按新列表顺序取，不按旧索引硬切', () => {
    // 旧列表顺序 a b c d e；筛选后顺序被改写成 e a d
    const filtered = items('e', 'a', 'd');
    // 锚点 'a'（旧索引 1）在新列表中是索引 1，目标 'e'（旧索引 4）在新列表中是索引 0
    // 正确区间应按新顺序取 ['e', 'a']，而不是按旧索引取一段
    assert.deepEqual(computeShiftRange(filtered, 'a', 'e'), ['e', 'a']);
  });
});
