// undoStore 单元测试（P3-4）
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  undoStorageKey,
  readUndoRecord,
  writeUndoRecord,
  clearUndoRecord,
} from './undoStore.ts';
import { UNDO_TTL_MS } from './undoConstants.ts';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  rawSet(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const repo = { owner: 'a', repo: 'b', branch: 'main' };

interface FakeFile {
  name: string;
  path: string;
}

describe('undoStorageKey', () => {
  it('键按 branch 隔离（M-R4 教训）', () => {
    const main = undoStorageKey({ owner: 'a', repo: 'b', branch: 'main' });
    const dev = undoStorageKey({ owner: 'a', repo: 'b', branch: 'dev' });
    assert.notEqual(main, dev);
  });
});

describe('readUndoRecord', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('TTL 内可读回', () => {
    writeUndoRecord<FakeFile>(
      repo,
      { files: [{ name: 'x.md', path: 'a/x.md' }], originalPaths: ['a/x.md'], deletedAt: Date.now() },
      storage
    );
    const record = readUndoRecord<FakeFile>(repo, storage);
    assert.equal(record?.originalPaths[0], 'a/x.md');
  });

  it('过期返回 null 且清理存储', () => {
    writeUndoRecord<FakeFile>(
      repo,
      { files: [{ name: 'x.md', path: 'a/x.md' }], originalPaths: ['a/x.md'], deletedAt: Date.now() - UNDO_TTL_MS - 1_000 },
      storage
    );
    assert.equal(readUndoRecord<FakeFile>(repo, storage), null);
    assert.equal(storage.getItem(undoStorageKey(repo)), null);
  });

  it('损坏 JSON 返回 null 不抛错', () => {
    storage.rawSet(undoStorageKey(repo), '{bad');
    assert.equal(readUndoRecord<FakeFile>(repo, storage), null);
  });
});

describe('clearUndoRecord', () => {
  it('清除后读不到', () => {
    const storage = new MemoryStorage();
    writeUndoRecord<FakeFile>(
      repo,
      { files: [{ name: 'x.md', path: 'a/x.md' }], originalPaths: ['a/x.md'], deletedAt: Date.now() },
      storage
    );
    clearUndoRecord(repo, storage);
    assert.equal(readUndoRecord<FakeFile>(repo, storage), null);
  });
});
