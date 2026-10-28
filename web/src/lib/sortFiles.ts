import type { ArticleFrontmatter } from '../../../shared/types';
import { parseDateToTimestamp } from './dateParse.ts';

export interface SortableFile {
  lastModified?: number;
  name: string;
}

export interface EnhancedSortableFile {
  name: string;
  path?: string;
  lastModified?: number;
  frontmatter?: ArticleFrontmatter;
  sortDate?: number;
}

/** 20260707 / 20260707123045 */
const COMPACT_NAME_TIME = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/;
/** 2026-07-07 / 2026_07_07 / 20260707-120000 */
const SEPARATED_NAME_TIME = /^(\d{4})[-_](\d{1,2})[-_](\d{1,2})(?:[-_T ](\d{1,2})[-_:](\d{1,2})[-_:](\d{1,2}))?/;

interface NameTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function toTimestamp(parts: NameTimeParts): number {
  const { year, month, day, hour, minute, second } = parts;
  if (year < 1970 || year > 9999) return 0;
  if (month < 1 || month > 12) return 0;
  if (day < 1 || day > 31) return 0;
  if (hour > 23 || minute > 59 || second > 59) return 0;
  const ts = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function partsOf(match: RegExpMatchArray): NameTimeParts {
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] ? Number(match[4]) : 0,
    minute: match[5] ? Number(match[5]) : 0,
    second: match[6] ? Number(match[6]) : 0,
  };
}

/**
 * 从文件名提取时间戳：20260707 / 20260707123045 / 2026-07-07 / 2026_07_07。
 * 非法日期（如 20261313）返回 0，不让脏文件名冒充有效时间。
 * 旧实现只认 `^(\d{8})(\d{6})?`，带分隔符的 2026-07-07-post.md 一律返回 0。
 */
export function extractTimestampFromFilename(name: string): number {
  const compact = name.match(COMPACT_NAME_TIME);
  if (compact) {
    const ts = toTimestamp(partsOf(compact));
    if (ts > 0) return ts;
  }
  const separated = name.match(SEPARATED_NAME_TIME);
  if (separated) {
    const ts = toTimestamp(partsOf(separated));
    if (ts > 0) return ts;
  }
  return 0;
}

/**
 * 统一排序键（单键，保证全序）：
 * 1. 文件内时间字段（sortDate，由 front-matter date 解析而来）
 * 2. front-matter date 的即时解析（快照复用路径可能没带 sortDate）
 * 3. 文件名时间
 * 4. 0 = 无任何时间信息
 *
 * 旧实现是「成对切换键」：两侧都有 date 才按 date 比较，否则按文件名比较。
 * 那不是合法比较器（不满足传递性，可构造出环），V8 TimSort 会给出依赖
 * 输入顺序、且存在局部逆序的结果。
 */
export function timeSortKey(file: EnhancedSortableFile): number {
  const fromMeta =
    file.sortDate && file.sortDate > 0
      ? file.sortDate
      : file.frontmatter?.date
        ? parseDateToTimestamp(file.frontmatter.date)
        : 0;
  if (fromMeta > 0) return fromMeta;
  return extractTimestampFromFilename(file.name);
}

/** 时间降序；同时间按 path 升序，保证输出确定（不依赖输入顺序） */
export function compareByTimeDesc(
  a: EnhancedSortableFile,
  b: EnhancedSortableFile
): number {
  const keyA = timeSortKey(a);
  const keyB = timeSortKey(b);
  if (keyA !== keyB) return keyB - keyA;
  const pathA = a.path ?? a.name;
  const pathB = b.path ?? b.name;
  return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
}

/**
 * 按时间降序排序（最新在前）：文件内时间字段优先，其次文件名时间。
 * 非破坏性：返回新数组，调用方必须接住返回值——旧调用点按副作用方式调用，
 * 在改为返回副本后曾静默失效（2026-09-09 → 2026-10-27）。
 */
export function sortByFrontMatterDate<T extends EnhancedSortableFile>(files: T[]): T[] {
  return [...files].sort(compareByTimeDesc);
}

/** 按 lastModified 降序排序（最新在前），用于非 Markdown 文件（媒体库） */
export function sortByLastModified<T extends SortableFile>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const timeA = a.lastModified || extractTimestampFromFilename(a.name);
    const timeB = b.lastModified || extractTimestampFromFilename(b.name);
    if (timeA !== timeB) return timeB - timeA;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}
