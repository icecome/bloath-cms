// localStorage 容错访问的最小抽象：多个 store 模块（draftPreviewStore /
// fileSnapshot / editorDraftStore）共用的注入接口与解析器。
// undoStore 用 sessionStorage（会话级语义不同），不在此列。

/** 最小化的 storage 接口，便于测试注入内存实现 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 解析 storage：显式传入优先，否则取全局 localStorage（不可用时返回 null） */
export function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  const g = globalThis as { localStorage?: StorageLike };
  return g.localStorage ?? null;
}
