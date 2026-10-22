// 编辑器草稿自动保存（本地副本）：防崩溃/误关丢稿。
//
// 设计对齐 draftPreviewStore 的既有范式：
// - localStorage 持久化，按 owner + repo + branch 隔离（键含 branch，M-R4 教训）；
// - StorageLike 注入便于测试；损坏数据降级为空存储，不抛错；
// - version 字段校验，不匹配按空存储处理。
//
// 生命周期：
// - 编辑器 onInput 节流写入（调用方控制节流）；
// - 保存成功后调用 clearEditorDraft 删除副本；
// - 进入编辑器时 readEditorDraft 与仓库内容比对 savedAt/mtime 决定是否提示恢复。
import type { ArticleFrontmatter } from '../../../shared/types';

/** 单篇草稿的本地副本 */
export interface EditorDraftCopy {
  /** 编辑中的文件路径（新建时为拟写入路径） */
  path: string;
  /** front-matter 表单值 */
  frontmatter: ArticleFrontmatter;
  /** 正文 Markdown */
  body: string;
  /** 最后写入时间戳 */
  savedAt: number;
}

/** localStorage 中的完整结构 */
export interface EditorDraftStore {
  version: 1;
  /** path → 草稿副本 */
  copies: Record<string, EditorDraftCopy>;
}

export const EDITOR_DRAFT_KEY_PREFIX = 'bloath_editordraft';
const STORE_VERSION = 1;

/** 本地副本上限（防止 localStorage 膨胀）：超出时淘汰最旧的副本 */
export const MAX_EDITOR_DRAFT_COPIES = 50;

// StorageLike 与 resolveStorage 统一由 storageLike.ts 提供（三处 store 同构抽象的去重）
import { resolveStorage, type StorageLike } from './storageLike.ts';
export type { StorageLike };

interface RepoScope {
  owner: string;
  repo: string;
  branch?: string;
}

/** 存储键：按 owner + repo + branch 隔离（branch 不可省略，M-R4 教训） */
export function editorDraftStorageKey(repo: RepoScope): string {
  return `${EDITOR_DRAFT_KEY_PREFIX}_${repo.owner}_${repo.repo}_${repo.branch || 'main'}`;
}

function emptyStore(): EditorDraftStore {
  return { version: STORE_VERSION, copies: {} };
}

/** 读取某仓库+分支的全部草稿副本；损坏或版本不匹配时返回空存储 */
export function readEditorDraftStore(repo: RepoScope, storage?: StorageLike): EditorDraftStore {
  const store = resolveStorage(storage);
  if (!store) return emptyStore();

  try {
    const raw = store.getItem(editorDraftStorageKey(repo));
    if (!raw) return emptyStore();

    const parsed = JSON.parse(raw) as Partial<EditorDraftStore> | null;
    if (!parsed || parsed.version !== STORE_VERSION || typeof parsed.copies !== 'object' || parsed.copies === null) {
      return emptyStore();
    }
    return parsed as EditorDraftStore;
  } catch (err) {
    console.warn('[editorDraft] 本地草稿读取失败，按空存储处理：', err);
    return emptyStore();
  }
}

/** 读取单篇草稿副本（按路径） */
export function readEditorDraft(repo: RepoScope, path: string, storage?: StorageLike): EditorDraftCopy | null {
  return readEditorDraftStore(repo, storage).copies[path] ?? null;
}

/**
 * 写入单篇草稿副本。
 * 超出上限时淘汰 savedAt 最旧的副本；写入失败（配额/隐私模式）静默降级。
 */
export function writeEditorDraft(
  repo: RepoScope,
  copy: EditorDraftCopy,
  storage?: StorageLike
): void {
  const store = resolveStorage(storage);
  if (!store) return;

  try {
    const current = readEditorDraftStore(repo, storage);
    const copies: Record<string, EditorDraftCopy> = { ...current.copies, [copy.path]: copy };

    // 容量控制：超出上限时按 savedAt 升序淘汰最旧副本
    const entries = Object.entries(copies);
    if (entries.length > MAX_EDITOR_DRAFT_COPIES) {
      entries.sort((a, b) => (a[1]?.savedAt ?? 0) - (b[1]?.savedAt ?? 0));
      for (const [key] of entries.slice(0, entries.length - MAX_EDITOR_DRAFT_COPIES)) {
        delete copies[key];
      }
    }

    const next: EditorDraftStore = { version: STORE_VERSION, copies };
    store.setItem(editorDraftStorageKey(repo), JSON.stringify(next));
  } catch (err) {
    console.warn('[editorDraft] 本地草稿写入失败（防丢稿功能降级）：', err);
  }
}

/** 删除单篇草稿副本（保存成功后调用） */
export function clearEditorDraft(repo: RepoScope, path: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;

  try {
    const current = readEditorDraftStore(repo, storage);
    if (!(path in current.copies)) return;
    const copies = { ...current.copies };
    delete copies[path];
    store.setItem(editorDraftStorageKey(repo), JSON.stringify({ version: STORE_VERSION, copies }));
  } catch (err) {
    console.warn('[editorDraft] 本地草稿清理失败：', err);
  }
}

/** 判断本地副本是否比仓库内容更新（决定是否提示恢复） */
export function isDraftCopyNewer(copy: EditorDraftCopy, repoItemModifiedAt: number | undefined): boolean {
  if (repoItemModifiedAt === undefined) return true;
  return copy.savedAt > repoItemModifiedAt;
}
