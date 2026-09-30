// 草稿预发布状态：localStorage 持久化 + 状态判定
//
// 设计取舍：
// - 存 localStorage 而非 S3/git：缓冲层（S3）是可选配置，无 S3 时它不可用；
//   叠加「未预发布不能发布」的规则会导致无 S3 环境发布功能死锁。
//   用 localStorage 后有无 S3 行为一致，且无需后端改动。
// - 仅本机有效，不做多设备同步（需求确认）。
import type { EnhancedFileItem } from './extractFrontMatter';

/** 草稿的预发布状态 */
export type DraftPreviewState = 'draft' | 'previewed' | 'preview-stale';

/** 单条预发布记录 */
export interface DraftPreviewRecord {
  /** 预发布目标目录，如 content/posts */
  previewTarget: string;
  /** 预发布时的内容 sha（git blob sha），用于检测预发布后内容是否变化 */
  contentSha: string;
  /**
   * 预发布时的 savedAt 回退值。
   * 新建的缓冲项 sha 为 ''（draftMerge.ts），无法用 sha 检测变化，
   * 此时退回比对 savedAt。
   */
  savedAt?: number;
  /** 预发布操作时间戳 */
  previewedAt: number;
}

/** localStorage 中的完整存储结构 */
export interface DraftPreviewStore {
  /** 数据格式版本，不匹配时按空存储处理（参照 repoConfigSync 的版本检查） */
  version: 1;
  /** 草稿路径 → 预发布记录 */
  records: Record<string, DraftPreviewRecord>;
}

export const PREVIEW_KEY_PREFIX = 'bloath_previews';
const STORE_VERSION = 1;

/** 最小化的 storage 接口，便于测试注入内存实现 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface RepoScope {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * 存储键：按 owner + repo + branch 隔离。
 *
 * 必须含 branch —— 否则在 main 预发布的草稿切到 dev 分支后，
 * 同名草稿会被错误显示为已预发布（见审查报告 M-R4 的同类缺陷）。
 */
export function previewStorageKey(repo: RepoScope): string {
  return `${PREVIEW_KEY_PREFIX}_${repo.owner}_${repo.repo}_${repo.branch || 'main'}`;
}

/** 解析 storage：显式传入优先，否则取全局 localStorage（不可用时返回 null） */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  const g = globalThis as { localStorage?: StorageLike };
  return g.localStorage ?? null;
}

function emptyStore(): DraftPreviewStore {
  return { version: STORE_VERSION, records: {} };
}

/** 读取某仓库+分支的预发布记录；损坏或版本不匹配时返回空存储 */
export function readPreviewStore(repo: RepoScope, storage?: StorageLike): DraftPreviewStore {
  const store = resolveStorage(storage);
  if (!store) return emptyStore();

  try {
    const raw = store.getItem(previewStorageKey(repo));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return emptyStore();
    const candidate = parsed as Partial<DraftPreviewStore>;
    if (candidate.version !== STORE_VERSION) return emptyStore();
    if (typeof candidate.records !== 'object' || candidate.records === null) return emptyStore();
    return { version: STORE_VERSION, records: candidate.records };
  } catch {
    // 存储损坏（JSON 非法）按未预发布处理
    return emptyStore();
  }
}

/** 写入完整存储；隐私模式/配额满时静默失败（不阻断页面） */
function writeStore(repo: RepoScope, value: DraftPreviewStore, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(previewStorageKey(repo), JSON.stringify(value));
  } catch {
    // 隐私模式或存储已满，忽略持久化错误
  }
}

/** 写入单条预发布记录；返回写入后的存储（便于调用方同步本地状态） */
export function writePreviewRecord(
  repo: RepoScope,
  path: string,
  record: DraftPreviewRecord,
  storage?: StorageLike
): DraftPreviewStore {
  const current = readPreviewStore(repo, storage);
  const next: DraftPreviewStore = {
    version: STORE_VERSION,
    records: { ...current.records, [path]: record },
  };
  writeStore(repo, next, storage);
  return next;
}

/** 批量写入（多选预发布场景） */
export function writePreviewRecords(
  repo: RepoScope,
  entries: ReadonlyArray<{ path: string; record: DraftPreviewRecord }>,
  storage?: StorageLike
): DraftPreviewStore {
  const current = readPreviewStore(repo, storage);
  const records = { ...current.records };
  for (const { path, record } of entries) {
    records[path] = record;
  }
  const next: DraftPreviewStore = { version: STORE_VERSION, records };
  writeStore(repo, next, storage);
  return next;
}

/** 删除单条记录 */
export function removePreviewRecord(
  repo: RepoScope,
  path: string,
  storage?: StorageLike
): DraftPreviewStore {
  const current = readPreviewStore(repo, storage);
  if (!(path in current.records)) return current;
  const records = { ...current.records };
  delete records[path];
  const next: DraftPreviewStore = { version: STORE_VERSION, records };
  writeStore(repo, next, storage);
  return next;
}

/**
 * 清理孤立记录并写回。
 *
 * 分两段处理的理由：列表渲染时只应「忽略」孤立项（渲染期不写存储，且草稿可能
 * 因网络抖动暂时不在列表中），仅在用户显式操作成功后才调用本函数写入存储。
 */
export function pruneAndPersist(
  repo: RepoScope,
  livePaths: ReadonlySet<string>,
  storage?: StorageLike
): DraftPreviewStore {
  const current = readPreviewStore(repo, storage);
  const records: Record<string, DraftPreviewRecord> = {};
  for (const [path, rec] of Object.entries(current.records)) {
    if (livePaths.has(path)) records[path] = rec;
  }
  const next: DraftPreviewStore = { version: STORE_VERSION, records };
  writeStore(repo, next, storage);
  return next;
}

/** 仅在内存中过滤孤立记录，不写存储（供渲染期使用） */
export function pruneOrphans(
  records: Readonly<Record<string, DraftPreviewRecord>>,
  livePaths: ReadonlySet<string>
): Record<string, DraftPreviewRecord> {
  const next: Record<string, DraftPreviewRecord> = {};
  for (const [path, rec] of Object.entries(records)) {
    if (livePaths.has(path)) next[path] = rec;
  }
  return next;
}

/**
 * 判断草稿在预发布后是否已被修改。
 *
 * 优先用 sha 比对；sha 不可用（新建缓冲项的 sha 为 ''）时退回 savedAt。
 * 两者都不可用时保守判为未过期 —— preview-stale 的作用是提醒，
 * 误报会让用户做无谓的重新预发布；漏报由发布时的二次确认防护。
 */
export function isStale(record: DraftPreviewRecord, item: EnhancedFileItem): boolean {
  if (record.contentSha && item.sha) {
    return record.contentSha !== item.sha;
  }
  if (record.savedAt !== undefined && item.lastModified !== undefined) {
    return item.lastModified > record.savedAt;
  }
  return false;
}

/** 判定单条草稿的预发布状态 */
export function resolvePreviewState(
  record: DraftPreviewRecord | undefined,
  item: EnhancedFileItem
): DraftPreviewState {
  if (!record) return 'draft';
  return isStale(record, item) ? 'preview-stale' : 'previewed';
}

/** 由草稿项构造预发布记录 */
export function buildPreviewRecord(item: EnhancedFileItem, previewTarget: string): DraftPreviewRecord {
  const record: DraftPreviewRecord = {
    previewTarget,
    contentSha: item.sha || '',
    previewedAt: Date.now(),
  };
  // sha 不可用时记录 savedAt 作为变更检测的回退依据
  if (!item.sha && item.lastModified !== undefined) {
    record.savedAt = item.lastModified;
  }
  return record;
}
