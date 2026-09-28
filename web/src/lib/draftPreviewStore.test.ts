import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  previewStorageKey,
  readPreviewStore,
  writePreviewRecord,
  writePreviewRecords,
  removePreviewRecord,
  pruneAndPersist,
  pruneOrphans,
  resolvePreviewState,
  isStale,
  buildPreviewRecord,
  PREVIEW_KEY_PREFIX,
  type StorageLike,
  type DraftPreviewRecord,
} from './draftPreviewStore.ts';
import type { EnhancedFileItem } from './extractFrontMatter.ts';

/** 内存 storage：避免污染全局 localStorage，且可模拟配额满 */
class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  /** 置 true 后 setItem 抛错，模拟隐私模式/配额满 */
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

  /** 测试辅助：直接塞入原始字符串，模拟损坏数据 */
  rawSet(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const repo = { owner: 'icecome', repo: 'test_blog', branch: 'main' };

function makeItem(over: Partial<EnhancedFileItem> = {}): EnhancedFileItem {
  return {
    name: '测试文章.md',
    path: '.draft/测试文章.md',
    sha: 'sha-aaa',
    type: 'file',
    lastModified: 1000,
    ...over,
  };
}

function makeRecord(over: Partial<DraftPreviewRecord> = {}): DraftPreviewRecord {
  return {
    previewTarget: 'content/posts',
    contentSha: 'sha-aaa',
    previewedAt: 1790000000000,
    ...over,
  };
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe('previewStorageKey', () => {
  it('按 owner / repo / branch 隔离', () => {
    assert.equal(previewStorageKey(repo), `${PREVIEW_KEY_PREFIX}_icecome_test_blog_main`);
    assert.equal(
      previewStorageKey({ owner: 'icecome', repo: 'test_blog', branch: 'dev' }),
      `${PREVIEW_KEY_PREFIX}_icecome_test_blog_dev`
    );
  });

  it('branch 缺省时回落 main', () => {
    assert.equal(previewStorageKey({ owner: 'a', repo: 'b' }), `${PREVIEW_KEY_PREFIX}_a_b_main`);
  });

  it('跨分支的键不同，避免状态串用', () => {
    const mainKey = previewStorageKey({ owner: 'o', repo: 'r', branch: 'main' });
    const devKey = previewStorageKey({ owner: 'o', repo: 'r', branch: 'dev' });
    assert.notEqual(mainKey, devKey);
  });
});

describe('readPreviewStore', () => {
  it('无记录时返回空存储', () => {
    const store = readPreviewStore(repo, storage);
    assert.deepEqual(store, { version: 1, records: {} });
  });

  it('JSON 损坏时降级为空存储而不抛错', () => {
    storage.rawSet(previewStorageKey(repo), '{ not valid json');
    const store = readPreviewStore(repo, storage);
    assert.deepEqual(store.records, {});
  });

  it('version 不匹配时返回空存储', () => {
    storage.rawSet(previewStorageKey(repo), JSON.stringify({ version: 99, records: { a: {} } }));
    const store = readPreviewStore(repo, storage);
    assert.deepEqual(store.records, {});
  });

  it('records 字段类型异常时返回空存储', () => {
    storage.rawSet(previewStorageKey(repo), JSON.stringify({ version: 1, records: 'nope' }));
    const store = readPreviewStore(repo, storage);
    assert.deepEqual(store.records, {});
  });

  it('storage 不可用时返回空存储', () => {
    const store = readPreviewStore(repo, undefined);
    assert.deepEqual(store.records, {});
  });
});

describe('writePreviewRecord / removePreviewRecord', () => {
  it('写入后可按键读回', () => {
    writePreviewRecord(repo, '.draft/a.md', makeRecord(), storage);
    const store = readPreviewStore(repo, storage);
    assert.equal(store.records['.draft/a.md']?.previewTarget, 'content/posts');
  });

  it('写入不覆盖同仓库的其他草稿记录', () => {
    writePreviewRecord(repo, '.draft/a.md', makeRecord({ previewTarget: 'content/posts' }), storage);
    writePreviewRecord(repo, '.draft/b.md', makeRecord({ previewTarget: 'content/moments' }), storage);
    const store = readPreviewStore(repo, storage);
    assert.equal(store.records['.draft/a.md']?.previewTarget, 'content/posts');
    assert.equal(store.records['.draft/b.md']?.previewTarget, 'content/moments');
  });

  it('不同分支的写入互不影响', () => {
    const devRepo = { ...repo, branch: 'dev' };
    writePreviewRecord(repo, '.draft/a.md', makeRecord({ previewTarget: 'content/posts' }), storage);
    writePreviewRecord(devRepo, '.draft/a.md', makeRecord({ previewTarget: 'content/dev' }), storage);
    assert.equal(readPreviewStore(repo, storage).records['.draft/a.md']?.previewTarget, 'content/posts');
    assert.equal(readPreviewStore(devRepo, storage).records['.draft/a.md']?.previewTarget, 'content/dev');
  });

  it('批量写入一次落盘多条', () => {
    writePreviewRecords(repo, [
      { path: '.draft/a.md', record: makeRecord() },
      { path: '.draft/b.md', record: makeRecord({ previewTarget: 'content/x' }) },
    ], storage);
    const store = readPreviewStore(repo, storage);
    assert.equal(Object.keys(store.records).length, 2);
  });

  it('删除后不再出现在记录中', () => {
    writePreviewRecord(repo, '.draft/a.md', makeRecord(), storage);
    removePreviewRecord(repo, '.draft/a.md', storage);
    assert.equal(readPreviewStore(repo, storage).records['.draft/a.md'], undefined);
  });

  it('删除不存在的键不报错', () => {
    const result = removePreviewRecord(repo, '.draft/none.md', storage);
    assert.deepEqual(result.records, {});
  });

  it('配额满时写入静默失败，不抛错', () => {
    storage.failOnWrite = true;
    assert.doesNotThrow(() => {
      writePreviewRecord(repo, '.draft/a.md', makeRecord(), storage);
    });
    // 未落盘，读回应为空
    assert.deepEqual(readPreviewStore(repo, storage).records, {});
  });
});

describe('pruneOrphans / pruneAndPersist', () => {
  it('只保留仍在草稿箱中的记录', () => {
    const records: Record<string, DraftPreviewRecord> = {
      '.draft/a.md': makeRecord(),
      '.draft/gone.md': makeRecord(),
    };
    const next = pruneOrphans(records, new Set(['.draft/a.md']));
    assert.deepEqual(Object.keys(next), ['.draft/a.md']);
  });

  it('空 livePaths 会清掉全部记录', () => {
    const records: Record<string, DraftPreviewRecord> = { '.draft/a.md': makeRecord() };
    assert.deepEqual(pruneOrphans(records, new Set()), {});
  });

  it('pruneAndPersist 会把清理结果写回存储', () => {
    writePreviewRecord(repo, '.draft/a.md', makeRecord(), storage);
    writePreviewRecord(repo, '.draft/gone.md', makeRecord(), storage);
    pruneAndPersist(repo, new Set(['.draft/a.md']), storage);
    const store = readPreviewStore(repo, storage);
    assert.deepEqual(Object.keys(store.records), ['.draft/a.md']);
  });

  it('pruneOrphans 不修改传入对象（纯函数）', () => {
    const records: Record<string, DraftPreviewRecord> = { '.draft/a.md': makeRecord() };
    pruneOrphans(records, new Set());
    assert.equal(Object.keys(records).length, 1);
  });
});

describe('isStale', () => {
  it('sha 一致时未过期', () => {
    assert.equal(isStale(makeRecord({ contentSha: 'sha-aaa' }), makeItem({ sha: 'sha-aaa' })), false);
  });

  it('sha 变化时过期', () => {
    assert.equal(isStale(makeRecord({ contentSha: 'sha-aaa' }), makeItem({ sha: 'sha-bbb' })), true);
  });

  it('sha 双方为空且 savedAt 更新时过期', () => {
    const record = makeRecord({ contentSha: '', savedAt: 1000 });
    assert.equal(isStale(record, makeItem({ sha: '', lastModified: 2000 })), true);
  });

  it('sha 双方为空且 savedAt 未变时未过期', () => {
    const record = makeRecord({ contentSha: '', savedAt: 2000 });
    assert.equal(isStale(record, makeItem({ sha: '', lastModified: 1000 })), false);
  });

  it('sha 一方为空时退回 savedAt 比对', () => {
    const record = makeRecord({ contentSha: '', savedAt: 500 });
    assert.equal(isStale(record, makeItem({ sha: 'sha-bbb', lastModified: 900 })), true);
  });

  it('两者都不可用时保守判为未过期', () => {
    const record = makeRecord({ contentSha: '' });
    assert.equal(isStale(record, makeItem({ sha: '' })), false);
  });
});

describe('resolvePreviewState', () => {
  it('无记录为 draft', () => {
    assert.equal(resolvePreviewState(undefined, makeItem()), 'draft');
  });

  it('sha 一致为 previewed', () => {
    assert.equal(resolvePreviewState(makeRecord({ contentSha: 's' }), makeItem({ sha: 's' })), 'previewed');
  });

  it('sha 变化为 preview-stale', () => {
    assert.equal(resolvePreviewState(makeRecord({ contentSha: 's' }), makeItem({ sha: 'other' })), 'preview-stale');
  });

  it('内容未变但记录 sha 为空时维持 previewed', () => {
    const record = makeRecord({ contentSha: '' });
    assert.equal(resolvePreviewState(record, makeItem({ sha: '' })), 'previewed');
  });
});

describe('buildPreviewRecord', () => {
  it('写入目标与当前 sha', () => {
    const rec = buildPreviewRecord(makeItem({ sha: 'sha-x' }), 'content/posts');
    assert.equal(rec.previewTarget, 'content/posts');
    assert.equal(rec.contentSha, 'sha-x');
    assert.ok(rec.previewedAt > 0);
  });

  it('sha 为空时额外记录 savedAt 作为兜底', () => {
    const rec = buildPreviewRecord(makeItem({ sha: '', lastModified: 12345 }), 'content/posts');
    assert.equal(rec.contentSha, '');
    assert.equal(rec.savedAt, 12345);
  });

  it('sha 有值时不写 savedAt（避免冗余字段）', () => {
    const rec = buildPreviewRecord(makeItem({ sha: 'sha-x' }), 'content/posts');
    assert.equal(rec.savedAt, undefined);
  });

  it('生成的记录可被 resolvePreviewState 判为 previewed', () => {
    const item = makeItem({ sha: 'sha-x' });
    const rec = buildPreviewRecord(item, 'content/posts');
    assert.equal(resolvePreviewState(rec, item), 'previewed');
  });
});
