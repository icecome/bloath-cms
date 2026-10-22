// 撤销（undo）存储：从 DashboardPage 提取的通用范式（P3-4），
// 让 Drafts 等其他列表页复用同一套「删除后一分钟内可撤销」机制。
//
// 键必须含 branch（M-R4 教训）：在 main 删除后切到 dev，撤销不得在 dev 上执行。
//
// 前缀与 TTL 直接内联（与 constants.ts 保持一致）：本模块要进 node --experimental-strip-types
// 测试链路，而 constants.ts 读取 import.meta.env 在 node 环境不可用。
// 修改 TTL/前缀时两处必须同步。
import { UNDO_STORAGE_PREFIX, UNDO_TTL_MS } from './undoConstants.ts';

/** 最小化的 storage 接口（sessionStorage 兼容），便于测试注入 */
export interface UndoStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface UndoScope {
  owner: string;
  repo: string;
  branch?: string;
}

/** 通用撤销记录：被移走的文件与原路径（恢复 = move 回去） */
export interface UndoRecord<TFile = unknown> {
  /** 单文件操作时为 1 元素数组；批量操作为全部被移文件 */
  files: TFile[];
  /** 与 files 一一对应的原路径 */
  originalPaths: string[];
  /** 操作时间戳（TTL 判定用） */
  deletedAt: number;
  /** 记录操作发生时的分支，恢复前二次比对 */
  branch?: string;
}

/** 撤销存储键：owner + repo + branch 隔离 */
export function undoStorageKey(repo: UndoScope): string {
  return `${UNDO_STORAGE_PREFIX}_${repo.owner}_${repo.repo}_${repo.branch || 'main'}`;
}

/** 读取撤销记录；过期/损坏返回 null 并清理存储 */
export function readUndoRecord<TFile>(
  repo: UndoScope,
  storage: UndoStorageLike
): UndoRecord<TFile> | null {
  try {
    const raw = storage.getItem(undoStorageKey(repo));
    if (!raw) return null;
    const record = JSON.parse(raw) as UndoRecord<TFile> | null;
    if (!record || typeof record.deletedAt !== 'number') {
      storage.removeItem(undoStorageKey(repo));
      return null;
    }
    if (Date.now() - record.deletedAt > UNDO_TTL_MS) {
      storage.removeItem(undoStorageKey(repo));
      return null;
    }
    return record;
  } catch (err) {
    console.warn('[undo] 撤销记录读取失败：', err);
    return null;
  }
}

/** 写入撤销记录（覆盖同仓库旧记录——一次只有一组可撤销操作） */
export function writeUndoRecord<TFile>(
  repo: UndoScope,
  record: UndoRecord<TFile>,
  storage: UndoStorageLike
): void {
  try {
    storage.setItem(undoStorageKey(repo), JSON.stringify(record));
  } catch (err) {
    // sessionStorage 满/不可用：撤销功能降级，不阻断主流程
    console.warn('[undo] 撤销记录写入失败：', err);
  }
}

/** 清除撤销记录（撤销执行后或用户主动放弃时） */
export function clearUndoRecord(repo: UndoScope, storage: UndoStorageLike): void {
  try {
    storage.removeItem(undoStorageKey(repo));
  } catch (err) {
    console.warn('[undo] 撤销记录清理失败：', err);
  }
}
