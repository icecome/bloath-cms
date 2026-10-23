// 树级 SHA 快照缓存：以「文件 sha 是否变化」判定是否需要重新提取 front-matter。
//
// 工作原理：
// 1. 列表扫描后，把该仓库+分支下全部 md 文件的 {path → sha} 存入 localStorage 快照；
// 2. 下次扫描时先 diff：sha 未变的文件直接复用上一轮的 front-matter 元数据，
//    只对新增/变更的文件走网络提取（extractBatch / readFile 回退）；
// 3. commitBatch 成功后调用 invalidateRepo 清空快照，保证提交后下一轮全量刷新。
//
// 设计取舍：
// - 存 localStorage 而非 IndexedDB：快照只存 path+sha 键值对（1000 文件约 100KB），
//   远低于 5MB 配额；且与 draftPreviewStore / profileService 的既有存储范式一致，
//   避免 web 侧为单一功能引入 IndexedDB 封装。
// - 快照按「仓库+分支」一个键存全部记录（与 draftPreviewStore 粒度一致），
//   避免遍历 localStorage key(i)。
// - 键必须含 branch（审查报告 M-R4 教训：切分支后不能复用旧快照）。
// - sha 为空的条目（新建缓冲项，draftMerge.ts 置 ''）不参与 diff，恒视为「已变化」。
import type { EnhancedFileItem } from './extractFrontMatter';

/** 快照条目：仅保留 diff 所需的最小字段 */
export interface SnapshotRecord {
  sha: string;
  /** 该文件上一轮的增强元数据（front-matter / sortDate），sha 未变时整体复用 */
  item: Pick<EnhancedFileItem, 'name' | 'path' | 'sha' | 'type' | 'size' | 'lastModified' | 'frontmatter' | 'sortDate'>;
}

/** localStorage 中的完整快照结构 */
export interface TreeSnapshot {
  /** 数据格式版本，不匹配时按空快照处理 */
  version: 1;
  /** 保存时间戳，用于诊断 */
  savedAt: number;
  /** path → 快照条目 */
  records: Record<string, SnapshotRecord>;
}

export const SNAPSHOT_KEY_PREFIX = 'bloath_treesnapshot';
const STORE_VERSION = 1;

/** 快照保存上限：超出后不再持久化（仍可用内存 diff），防止 localStorage 配额溢出 */
export const MAX_SNAPSHOT_ENTRIES = 5000;

// StorageLike 与 resolveStorage 统一由 storageLike.ts 提供（三处 store 同构抽象的去重）
import { resolveStorage, type StorageLike } from './storageLike.ts';
export type { StorageLike };

interface RepoScope {
  owner: string;
  repo: string;
  branch?: string;
}

/** 快照存储键：按 owner + repo + branch 隔离（branch 不可省略，见文件头 M-R4 说明） */
export function snapshotStorageKey(repo: RepoScope): string {
  return `${SNAPSHOT_KEY_PREFIX}_${repo.owner}_${repo.repo}_${repo.branch || 'main'}`;
}

function emptySnapshot(): TreeSnapshot {
  return { version: STORE_VERSION, savedAt: 0, records: {} };
}

/** 读取某仓库+分支的快照；损坏或版本不匹配时返回空快照，不抛错 */
export function readSnapshot(repo: RepoScope, storage?: StorageLike): TreeSnapshot {
  const store = resolveStorage(storage);
  if (!store) return emptySnapshot();

  try {
    const raw = store.getItem(snapshotStorageKey(repo));
    if (!raw) return emptySnapshot();

    const parsed = JSON.parse(raw) as Partial<TreeSnapshot> | null;
    if (!parsed || parsed.version !== STORE_VERSION || typeof parsed.records !== 'object' || parsed.records === null) {
      return emptySnapshot();
    }
    return parsed as TreeSnapshot;
  } catch (err) {
    console.warn('[fileSnapshot] 快照读取失败，按空快照处理：', err);
    return emptySnapshot();
  }
}

/**
 * 把一批增强文件项写入快照。
 *
 * 合并语义（不是覆盖）：快照是「整个仓库的索引」，而不是「最近一次扫描路径的快照」。
 * 各页面只扫描自己的 basePath（内容库/草稿箱/回收站），若每次覆盖，
 * 全局搜索与引用扫描只能看到最后一次扫描过的目录。因此这里保留其他路径的旧记录，
 * 仅更新本次扫描到的路径。清理靠 clearCache → invalidateSnapshot（提交后整体失效）。
 *
 * 写入失败（配额/隐私模式）静默降级为内存无快照。
 */
export function saveSnapshot(
  repo: RepoScope,
  files: EnhancedFileItem[],
  storage?: StorageLike
): TreeSnapshot {
  const store = resolveStorage(storage);
  const previous = readSnapshot(repo, storage);
  const records: Record<string, SnapshotRecord> = { ...previous.records };

  for (const file of files.slice(0, MAX_SNAPSHOT_ENTRIES)) {
    records[file.path] = {
      sha: file.sha,
      item: {
        name: file.name,
        path: file.path,
        sha: file.sha,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        frontmatter: file.frontmatter,
        sortDate: file.sortDate,
      },
    };
  }

  // 合并后总量仍受上限约束：超出时保留 savedAt 较新的条目（本次写入的优先），
  // 避免多目录扫描累积突破 localStorage 配额。
  const allPaths = Object.keys(records);
  const cappedRecords: Record<string, SnapshotRecord> =
    allPaths.length <= MAX_SNAPSHOT_ENTRIES
      ? records
      : Object.fromEntries(
          allPaths
            .sort((a, b) => (records[b]?.item.lastModified ?? 0) - (records[a]?.item.lastModified ?? 0))
            .slice(0, MAX_SNAPSHOT_ENTRIES)
            .map((path) => [path, records[path] as SnapshotRecord])
        );

  const snapshot: TreeSnapshot = { version: STORE_VERSION, savedAt: Date.now(), records: cappedRecords };

  if (store) {
    try {
      store.setItem(snapshotStorageKey(repo), JSON.stringify(snapshot));
    } catch (err) {
      // 配额满或隐私模式：快照不可用不影响功能，仅损失下一轮的增量加速
      console.warn('[fileSnapshot] 快照写入失败（将退化为全量提取）：', err);
    }
  }

  return snapshot;
}

/** 删除某仓库+分支的快照（commitBatch 成功后调用，保证提交后下一轮全量刷新） */
export function invalidateSnapshot(repo: RepoScope, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(snapshotStorageKey(repo));
  } catch (err) {
    console.warn('[fileSnapshot] 快照清理失败：', err);
  }
}

/**
 * 扫描结果分类：快照 sha 与本轮扫描 sha 的 diff 结果。
 * - unchanged：sha 一致且快照里有增强元数据，可直接复用，无需网络请求；
 * - changed：新增文件、sha 变化、或快照无增强元数据（上一轮提取失败），需重新提取。
 */
export interface SnapshotDiff {
  unchanged: EnhancedFileItem[];
  changed: EnhancedFileItem[];
}

/** 对比本轮扫描出的文件列表与快照，产出「可复用 / 需重提」两组 */
export function diffAgainstSnapshot(
  repo: RepoScope,
  scannedFiles: EnhancedFileItem[],
  storage?: StorageLike
): SnapshotDiff {
  const snapshot = readSnapshot(repo, storage);
  const unchanged: EnhancedFileItem[] = [];
  const changed: EnhancedFileItem[] = [];

  for (const file of scannedFiles) {
    const record = snapshot.records[file.path];

    // sha 缺失（新建缓冲项）或快照无记录：必须重新提取
    if (!file.sha || !record || record.sha !== file.sha) {
      changed.push(file);
      continue;
    }

    // sha 一致但上一轮没有拿到 front-matter（提取失败残留）：也要重提
    if (!record.item.frontmatter) {
      changed.push(file);
      continue;
    }

    unchanged.push({
      ...record.item,
      // 这两个字段是列表合并时叠加的状态，不随快照走
      source: file.source,
      publishTarget: file.publishTarget,
      previewState: file.previewState,
      previewTarget: file.previewTarget,
    });
  }

  return { unchanged, changed };
}
