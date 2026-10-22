// 树级 SHA 快照缓存单元测试
// 运行方式：node --experimental-strip-types --test src/lib/fileSnapshot.test.ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotStorageKey,
  readSnapshot,
  saveSnapshot,
  invalidateSnapshot,
  diffAgainstSnapshot,
  SNAPSHOT_KEY_PREFIX,
  MAX_SNAPSHOT_ENTRIES,
  type StorageLike,
} from './fileSnapshot.ts';
import type { EnhancedFileItem } from './extractFrontMatter.ts';

/** 内存 storage：与 draftPreviewStore.test.ts 同范式 */
class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  failOnWrite = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  rawSet(key: string, value: string): void {
    this.map.set(key, value);
  }

  rawGet(key: string): string | undefined {
    return this.map.get(key);
  }
}

const repo = { owner: 'icecome', repo: 'test_blog', branch: 'main' };

function makeItem(over: Partial<EnhancedFileItem> = {}): EnhancedFileItem {
  return {
    name: '文章.md',
    path: 'content/文章.md',
    sha: 'sha-1',
    type: 'file',
    size: 100,
    lastModified: 1000,
    frontmatter: { title: '文章', date: '2026-01-01' },
    sortDate: 1767225600000,
    ...over,
  };
}

describe('snapshotStorageKey', () => {
  it('键包含 owner/repo/branch，不同分支产生不同键', () => {
    const main = snapshotStorageKey({ owner: 'a', repo: 'b', branch: 'main' });
    const dev = snapshotStorageKey({ owner: 'a', repo: 'b', branch: 'dev' });
    const noBranch = snapshotStorageKey({ owner: 'a', repo: 'b' });

    assert.notEqual(main, dev);
    assert.equal(noBranch, snapshotStorageKey({ owner: 'a', repo: 'b', branch: 'main' }));
    assert.ok(main.startsWith(SNAPSHOT_KEY_PREFIX));
  });
});

describe('readSnapshot', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('无数据时返回空快照（version=1、records 为空对象）', () => {
    const snap = readSnapshot(repo, storage);
    assert.equal(snap.version, 1);
    assert.deepEqual(snap.records, {});
  });

  it('损坏 JSON 返回空快照且不抛错', () => {
    storage.rawSet(snapshotStorageKey(repo), '{not-json');
    const snap = readSnapshot(repo, storage);
    assert.deepEqual(snap.records, {});
  });

  it('version 不匹配返回空快照', () => {
    storage.rawSet(snapshotStorageKey(repo), JSON.stringify({ version: 99, records: { a: {} } }));
    const snap = readSnapshot(repo, storage);
    assert.deepEqual(snap.records, {});
  });

  it('records 非对象返回空快照', () => {
    storage.rawSet(snapshotStorageKey(repo), JSON.stringify({ version: 1, records: 'nope' }));
    assert.deepEqual(readSnapshot(repo, storage).records, {});
  });

  it('localStorage 不可用时返回空快照', () => {
    const snap = readSnapshot(repo, undefined);
    assert.deepEqual(snap.records, {});
  });
});

describe('saveSnapshot / readSnapshot', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('保存后可读回相同的 sha 与增强元数据', () => {
    const files = [makeItem(), makeItem({ path: 'content/二.md', sha: 'sha-2', name: '二.md' })];
    saveSnapshot(repo, files, storage);

    const snap = readSnapshot(repo, storage);
    assert.equal(snap.records['content/文章.md']?.sha, 'sha-1');
    assert.equal(snap.records['content/文章.md']?.item.frontmatter?.title, '文章');
    assert.equal(snap.records['content/二.md']?.sha, 'sha-2');
    assert.ok(snap.savedAt > 0);
  });

  it('写入失败（配额满）不抛错', () => {
    storage.failOnWrite = true;
    assert.doesNotThrow(() => saveSnapshot(repo, [makeItem()], storage));
  });

  it('超过上限时只保留前 MAX_SNAPSHOT_ENTRIES 条', () => {
    const files: EnhancedFileItem[] = [];
    for (let i = 0; i < MAX_SNAPSHOT_ENTRIES + 10; i++) {
      files.push(makeItem({ path: `content/${i}.md`, sha: `sha-${i}` }));
    }
    const snap = saveSnapshot(repo, files, storage);
    assert.equal(Object.keys(snap.records).length, MAX_SNAPSHOT_ENTRIES);
  });
});

describe('invalidateSnapshot', () => {
  it('删除后读取为空', () => {
    const storage = new MemoryStorage();
    saveSnapshot(repo, [makeItem()], storage);
    invalidateSnapshot(repo, storage);
    assert.deepEqual(readSnapshot(repo, storage).records, {});
  });

  it('storage 异常时不抛错', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('boom');
      },
      removeItem: () => {
        throw new Error('boom');
      },
    };
    assert.doesNotThrow(() => invalidateSnapshot(repo, storage));
  });
});

describe('diffAgainstSnapshot', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('空快照时全部文件归入 changed', () => {
    const files = [makeItem(), makeItem({ path: 'content/二.md', sha: 'sha-2' })];
    const { unchanged, changed } = diffAgainstSnapshot(repo, files, storage);
    assert.equal(unchanged.length, 0);
    assert.equal(changed.length, 2);
  });

  it('sha 一致且有元数据的文件归入 unchanged', () => {
    saveSnapshot(repo, [makeItem()], storage);
    const { unchanged, changed } = diffAgainstSnapshot(repo, [makeItem()], storage);
    assert.equal(unchanged.length, 1);
    assert.equal(changed.length, 0);
    assert.equal(unchanged[0]?.frontmatter?.title, '文章');
  });

  it('sha 变化的文件归入 changed', () => {
    saveSnapshot(repo, [makeItem()], storage);
    const edited = makeItem({ sha: 'sha-new' });
    const { unchanged, changed } = diffAgainstSnapshot(repo, [edited], storage);
    assert.equal(unchanged.length, 0);
    assert.deepEqual(changed, [edited]);
  });

  it('新增文件（快照无记录）归入 changed', () => {
    saveSnapshot(repo, [makeItem()], storage);
    const added = makeItem({ path: 'content/新.md', sha: 'sha-x' });
    const { changed } = diffAgainstSnapshot(repo, [makeItem(), added], storage);
    assert.equal(changed.length, 1);
    assert.equal(changed[0]?.path, 'content/新.md');
  });

  it('删除的文件不出现在 diff 结果中（由调用方按扫描列表为准）', () => {
    saveSnapshot(repo, [makeItem(), makeItem({ path: 'content/旧.md', sha: 'sha-old' })], storage);
    const { unchanged, changed } = diffAgainstSnapshot(repo, [makeItem()], storage);
    assert.equal(unchanged.length, 1);
    assert.equal(changed.length, 0);
  });

  it('sha 为空的文件（新建缓冲项）恒归入 changed', () => {
    saveSnapshot(repo, [makeItem({ sha: '' })], storage);
    const emptySha = makeItem({ sha: '' });
    const { unchanged, changed } = diffAgainstSnapshot(repo, [emptySha], storage);
    assert.equal(unchanged.length, 0);
    assert.equal(changed.length, 1);
  });

  it('快照无 front-matter（上轮提取失败残留）归入 changed', () => {
    const noFm = makeItem();
    // 保存一个没有 frontmatter 的快照条目：先存完整项再篡改
    saveSnapshot(repo, [noFm], storage);
    const rawKey = snapshotStorageKey(repo);
    const snap = JSON.parse(storage.rawGet(rawKey) ?? '{}');
    delete snap.records['content/文章.md'].item.frontmatter;
    storage.rawSet(rawKey, JSON.stringify(snap));

    const { unchanged, changed } = diffAgainstSnapshot(repo, [noFm], storage);
    assert.equal(unchanged.length, 0);
    assert.equal(changed.length, 1);
  });

  it('unchanged 项继承本轮叠加的 source/previewState 等列表状态', () => {
    saveSnapshot(repo, [makeItem()], storage);
    const scanned = makeItem({ source: 'buffer-modified', previewState: 'previewed', previewTarget: 'content/posts' });
    const { unchanged } = diffAgainstSnapshot(repo, [scanned], storage);
    assert.equal(unchanged[0]?.source, 'buffer-modified');
    assert.equal(unchanged[0]?.previewState, 'previewed');
    assert.equal(unchanged[0]?.previewTarget, 'content/posts');
  });
});
