// 全局搜索单元测试（P2-5）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEntry, searchEntries, SEARCH_WEIGHT_TITLE, SEARCH_WEIGHT_TAG, SEARCH_WEIGHT_PATH } from './globalSearch.ts';
import type { EnhancedFileItem } from './extractFrontMatter.ts';

function item(over: Partial<EnhancedFileItem>): EnhancedFileItem {
  return {
    name: '文章.md',
    path: 'content/posts/文章.md',
    sha: 's',
    type: 'file',
    ...over,
  };
}

describe('scoreEntry', () => {
  it('空搜索词返回 null', () => {
    assert.equal(scoreEntry(item({}), '  '), null);
  });

  it('标题命中计 10 分', () => {
    const hit = scoreEntry(item({ frontmatter: { title: 'Hello World' } }), 'hello');
    assert.equal(hit?.score, SEARCH_WEIGHT_TITLE);
    assert.deepEqual(hit?.matchedIn, ['title']);
  });

  it('标签命中计 5 分', () => {
    const hit = scoreEntry(item({ frontmatter: { tags: ['tech', 'life'] } }), 'tech');
    assert.equal(hit?.score, SEARCH_WEIGHT_TAG);
    assert.deepEqual(hit?.matchedIn, ['tag']);
  });

  it('路径命中计 2 分', () => {
    const hit = scoreEntry(item({ path: 'content/posts/golang.md', name: 'golang.md' }), 'golang');
    assert.equal(hit?.score, SEARCH_WEIGHT_PATH);
  });

  it('标题+标签同时命中叠加 15 分', () => {
    const hit = scoreEntry(
      item({ frontmatter: { title: 'golang 入门', tags: ['golang'] } }),
      'golang'
    );
    assert.equal(hit?.score, SEARCH_WEIGHT_TITLE + SEARCH_WEIGHT_TAG);
    assert.deepEqual(hit?.matchedIn, ['title', 'tag']);
  });

  it('未命中返回 null', () => {
    assert.equal(scoreEntry(item({ frontmatter: { title: '别的内容' } }), 'golang'), null);
  });

  it('大小写不敏感', () => {
    assert.ok(scoreEntry(item({ frontmatter: { title: 'GOLANG Guide' } }), 'golang'));
  });
});

describe('searchEntries', () => {
  it('按得分降序排列', () => {
    const items = [
      item({ path: 'a.md', name: 'a.md', frontmatter: { tags: ['kw'] } }),            // 5
      item({ path: 'b.md', name: 'b.md', frontmatter: { title: 'kw 主题' } }),        // 10
      item({ path: 'c-kw.md', name: 'c-kw.md' }),                                     // 2
    ];
    const results = searchEntries(items, 'kw');
    assert.equal(results.length, 3);
    assert.equal(results[0]?.item.path, 'b.md');
    assert.equal(results[1]?.item.path, 'a.md');
    assert.equal(results[2]?.item.path, 'c-kw.md');
  });

  it('同分按路径排序（稳定输出）', () => {
    const items = [
      item({ path: 'z.md', name: 'kw.md' }),
      item({ path: 'a.md', name: 'kw.md' }),
    ];
    const results = searchEntries(items, 'kw');
    assert.equal(results[0]?.item.path, 'a.md');
    assert.equal(results[1]?.item.path, 'z.md');
  });

  it('无命中返回空数组', () => {
    assert.deepEqual(searchEntries([item({})], 'nothing-matches'), []);
  });
});
