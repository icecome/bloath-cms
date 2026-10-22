// 发布路径解析语义单元测试（M-R2 回归锁定）
//
// 背景：publish.service.ts 的 move 分支曾因「无 target 时误调 resolvePublishPath」
// 导致 fromPath === path，Git tree 同路径「先写后删」→ 仓库文件静默丢失。
// 修复后的语义抽到零依赖的 publish-paths.ts，本测试文件是它的行为规范：
// 任何人改动解析逻辑，先让这里全绿。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublishPath, resolveMoveTarget } from './publish-paths.ts';

describe('resolvePublishPath（write 条目的目标解析）', () => {
  it('有 target：目标目录 + 原文件名', () => {
    assert.equal(
      resolvePublishPath('.draft/hello.md', 'content/posts'),
      'content/posts/hello.md'
    );
  });

  it('有 target：target 尾部斜杠被归一', () => {
    assert.equal(
      resolvePublishPath('.draft/hello.md', 'content/posts/'),
      'content/posts/hello.md'
    );
    assert.equal(
      resolvePublishPath('.draft/hello.md', 'content/posts//'),
      'content/posts/hello.md'
    );
  });

  it('无 target：保持原路径（降级落草稿目录）', () => {
    assert.equal(resolvePublishPath('.draft/hello.md', undefined), '.draft/hello.md');
    assert.equal(resolvePublishPath('.draft/hello.md', null), '.draft/hello.md');
    assert.equal(resolvePublishPath('.draft/hello.md', ''), '.draft/hello.md');
  });

  it('中文文件名原样保留', () => {
    assert.equal(
      resolvePublishPath('.draft/测试文章.md', 'content/posts'),
      'content/posts/测试文章.md'
    );
  });

  it('深层路径只取最后一段', () => {
    assert.equal(
      resolvePublishPath('.draft/sub/dir/hello.md', 'content/posts'),
      'content/posts/hello.md'
    );
  });
});

describe('resolveMoveTarget（move 条目的目标解析，M-R2 语义）', () => {
  it('无 target：返回 path 本身（path 已是目标路径，不得重解析）', () => {
    // 关键回归用例：缓冲层移入回收站写入的条目 path=回收站路径。
    // 若误用 resolvePublishPath，这里会返回 fromPath（解析回源路径），
    // 产生 fromPath === path 的移动 → 文件丢失。
    assert.equal(resolveMoveTarget('.trash/hello.md', undefined), '.trash/hello.md');
    assert.equal(resolveMoveTarget('.trash/hello.md', null), '.trash/hello.md');
  });

  it('有 target：按 resolvePublishPath 语义重写', () => {
    assert.equal(
      resolveMoveTarget('.trash/hello.md', 'content/posts'),
      'content/posts/hello.md'
    );
  });

  it('与 resolvePublishPath 的一致性：有 target 时两者等价', () => {
    const cases: Array<[string, string]> = [
      ['.draft/a.md', 'content/posts'],
      ['.draft/中文.md', 'x/y'],
    ];
    for (const [path, target] of cases) {
      assert.equal(resolveMoveTarget(path, target), resolvePublishPath(path, target));
    }
  });
});
