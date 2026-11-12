// gitTreeCache 单元测试：键构造 + 缓存可用性判定（两个不变量都锁死）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { treeCacheKey, isTreeCacheUsable } from './gitTreeCache.ts';

describe('treeCacheKey', () => {
  it('mode 参与键：plain 与 filename 不串味', () => {
    const plain = treeCacheKey('o', 'r', 'main');
    const filename = treeCacheKey('o', 'r', 'main', 'filename');
    assert.equal(plain, 'tree:o/r:main:plain');
    assert.equal(filename, 'tree:o/r:main:filename');
    assert.notEqual(plain, filename);
  });

  it('分支与仓库名原样进键（不同后端不互串）', () => {
    assert.equal(treeCacheKey('icecome', 'img', 'assets'), 'tree:icecome/img:assets:plain');
  });
});

describe('isTreeCacheUsable', () => {
  const stamped = [
    { name: 'a.jpg', path: 'a.jpg', sha: 's1', type: 'file' as const, lastModified: 1730000000000 },
  ];
  const zeroStamped = [
    { name: 'a.jpg', path: 'a.jpg', sha: 's1', type: 'file' as const, lastModified: 0 },
  ];

  it('plain 模式：形状合法即命中', () => {
    assert.equal(isTreeCacheUsable(zeroStamped, false), true);
  });

  it('filename 模式：带正时间戳才可信', () => {
    assert.equal(isTreeCacheUsable(stamped, true), true);
  });

  it('filename 模式：全零时间戳按 miss 处理（旧「填充前写缓存」脏数据防线）', () => {
    assert.equal(isTreeCacheUsable(zeroStamped, true), false);
  });

  it('空数组 / 非数组 / 非对象项 / 缺 path 一律 miss', () => {
    assert.equal(isTreeCacheUsable([], true), false);
    assert.equal(isTreeCacheUsable([], false), false);
    assert.equal(isTreeCacheUsable('not json array', false), false);
    assert.equal(isTreeCacheUsable([null], false), false);
    assert.equal(isTreeCacheUsable([{ name: 'x' }], false), false);
  });

  it('lastModified 非数字不被当成有效时间戳', () => {
    assert.equal(
      isTreeCacheUsable([{ path: 'a', lastModified: '1730000000000' }], true),
      false
    );
  });
});
