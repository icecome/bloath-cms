// 编辑器草稿自动保存单元测试
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  editorDraftStorageKey,
  readEditorDraftStore,
  readEditorDraft,
  writeEditorDraft,
  clearEditorDraft,
  isDraftCopyNewer,
  EDITOR_DRAFT_KEY_PREFIX,
  MAX_EDITOR_DRAFT_COPIES,
  type StorageLike,
  type EditorDraftCopy,
} from './editorDraftStore.ts';

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
}

const repo = { owner: 'icecome', repo: 'blog', branch: 'main' };

function makeCopy(over: Partial<EditorDraftCopy> = {}): EditorDraftCopy {
  return {
    path: '.draft/测试.md',
    frontmatter: { title: '测试' },
    body: '# 正文',
    savedAt: 1000,
    ...over,
  };
}

describe('editorDraftStorageKey', () => {
  it('键按 owner/repo/branch 隔离', () => {
    const main = editorDraftStorageKey({ owner: 'a', repo: 'b', branch: 'main' });
    const dev = editorDraftStorageKey({ owner: 'a', repo: 'b', branch: 'dev' });
    assert.notEqual(main, dev);
    assert.ok(main.startsWith(EDITOR_DRAFT_KEY_PREFIX));
  });
});

describe('readEditorDraftStore', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('无数据返回空存储', () => {
    const store = readEditorDraftStore(repo, storage);
    assert.equal(store.version, 1);
    assert.deepEqual(store.copies, {});
  });

  it('损坏 JSON 返回空存储不抛错', () => {
    storage.rawSet(editorDraftStorageKey(repo), '{bad');
    assert.deepEqual(readEditorDraftStore(repo, storage).copies, {});
  });

  it('version 不匹配返回空存储', () => {
    storage.rawSet(editorDraftStorageKey(repo), JSON.stringify({ version: 9, copies: {} }));
    assert.deepEqual(readEditorDraftStore(repo, storage).copies, {});
  });
});

describe('writeEditorDraft / readEditorDraft', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('写入后可读回', () => {
    writeEditorDraft(repo, makeCopy(), storage);
    const copy = readEditorDraft(repo, '.draft/测试.md', storage);
    assert.equal(copy?.frontmatter.title, '测试');
    assert.equal(copy?.body, '# 正文');
  });

  it('同路径覆盖旧副本', () => {
    writeEditorDraft(repo, makeCopy({ body: 'v1' }), storage);
    writeEditorDraft(repo, makeCopy({ body: 'v2', savedAt: 2000 }), storage);
    assert.equal(readEditorDraft(repo, '.draft/测试.md', storage)?.body, 'v2');
  });

  it('超出上限时淘汰 savedAt 最旧的副本', () => {
    for (let i = 0; i < MAX_EDITOR_DRAFT_COPIES + 3; i++) {
      writeEditorDraft(
        repo,
        makeCopy({ path: `.draft/${i}.md`, savedAt: i }),
        storage
      );
    }
    const store = readEditorDraftStore(repo, storage);
    assert.equal(Object.keys(store.copies).length, MAX_EDITOR_DRAFT_COPIES);
    // 最旧的 0/1/2 被淘汰
    assert.equal(readEditorDraft(repo, '.draft/0.md', storage), null);
    assert.ok(readEditorDraft(repo, `.draft/${MAX_EDITOR_DRAFT_COPIES}.md`, storage));
  });

  it('写入失败（配额满）不抛错', () => {
    storage.failOnWrite = true;
    assert.doesNotThrow(() => writeEditorDraft(repo, makeCopy(), storage));
  });
});

describe('clearEditorDraft', () => {
  it('删除指定副本，其余保留', () => {
    const storage = new MemoryStorage();
    writeEditorDraft(repo, makeCopy(), storage);
    writeEditorDraft(repo, makeCopy({ path: '.draft/二.md' }), storage);

    clearEditorDraft(repo, '.draft/测试.md', storage);
    assert.equal(readEditorDraft(repo, '.draft/测试.md', storage), null);
    assert.ok(readEditorDraft(repo, '.draft/二.md', storage));
  });

  it('删除不存在的路径不抛错', () => {
    const storage = new MemoryStorage();
    assert.doesNotThrow(() => clearEditorDraft(repo, '.draft/不存在.md', storage));
  });
});

describe('isDraftCopyNewer', () => {
  it('仓库无时间信息时视为本地更新', () => {
    assert.ok(isDraftCopyNewer(makeCopy(), undefined));
  });

  it('本地副本时间晚于仓库 → 更新', () => {
    assert.ok(isDraftCopyNewer(makeCopy({ savedAt: 2000 }), 1000));
  });

  it('仓库时间晚于本地副本 → 不提示恢复', () => {
    assert.ok(!isDraftCopyNewer(makeCopy({ savedAt: 1000 }), 2000));
  });
});
