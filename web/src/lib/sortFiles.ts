import type { ArticleFrontmatter } from '../../../shared/types';
import { parseDateToTimestamp } from './extractFrontMatter';

export interface SortableFile {
  lastModified?: number;
  name: string;
}

/**
 * 从文件名提取时间戳（支持 8 位日期和 14 位时间戳）
 * 作为 Front Matter 解析失败时的降级方案
 */
function extractTimestampFromFilename(name: string): number {
  const match = name.match(/^(\d{8})(\d{6})?/);
  if (!match) return 0;
  const dateStr = match[2] ? `${match[1]}${match[2]}` : `${match[1]}000000`;
  const ts = new Date(
    `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T${dateStr.slice(8,10)}:${dateStr.slice(10,12)}:${dateStr.slice(12,14)}`
  ).getTime();
  return isNaN(ts) ? 0 : ts;
}

export interface EnhancedSortableFile {
  name: string;
  lastModified?: number;
  frontmatter?: ArticleFrontmatter;
  sortDate?: number;
}

/**
 * 按 Front Matter date 字段降序排序（最新在前）
 * 降级策略（不再使用 Commits API）：
 * 1. 优先使用 frontmatter.date
 * 2. 回退到文件名提取时间（YYYYMMDD 格式）
 */
export function sortByFrontMatterDate<T extends EnhancedSortableFile>(files: T[]): T[] {
  return files.sort((a, b) => {
    // 第一优先级：Front Matter date
    const dateA = a.sortDate || (a.frontmatter?.date ? parseDateToTimestamp(a.frontmatter.date) : 0);
    const dateB = b.sortDate || (b.frontmatter?.date ? parseDateToTimestamp(b.frontmatter.date) : 0);

    if (dateA !== dateB && dateA > 0 && dateB > 0) {
      return dateB - dateA; // 降序
    }

    // 第二优先级：文件名提取时间（降级兜底）
    const timeA = extractTimestampFromFilename(a.name);
    const timeB = extractTimestampFromFilename(b.name);

    if (timeA !== timeB) {
      return timeB - timeA;
    }

    return 0;
  });
}

/**
 * 按 lastModified 降序排序（最新在前）
 * 用于非 Markdown 文件（如媒体库图片）的排序
 * 如果 lastModified 为 0，则使用文件名提取时间作为降级方案
 */
export function sortByLastModified<T extends SortableFile>(files: T[]): T[] {
  return files.sort((a, b) => {
    const timeA = a.lastModified || extractTimestampFromFilename(a.name);
    const timeB = b.lastModified || extractTimestampFromFilename(b.name);

    if (timeA !== timeB) {
      return timeB - timeA;
    }

    return 0;
  });
}
