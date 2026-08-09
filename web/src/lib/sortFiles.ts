import type { ArticleFrontmatter } from '../../../shared/types';
import { parseDateToTimestamp } from './extractFrontMatter';

export interface SortableFile {
  lastModified?: number;
  name: string;
}

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

export function sortByFrontMatterDate<T extends EnhancedSortableFile>(files: T[]): T[] {
  return files.sort((a, b) => {
    const dateA = a.sortDate || (a.frontmatter?.date ? parseDateToTimestamp(a.frontmatter.date) : 0);
    const dateB = b.sortDate || (b.frontmatter?.date ? parseDateToTimestamp(b.frontmatter.date) : 0);

    if (dateA !== dateB && dateA > 0 && dateB > 0) {
      return dateB - dateA;
    }

    const timeA = extractTimestampFromFilename(a.name);
    const timeB = extractTimestampFromFilename(b.name);

    if (timeA !== timeB) {
      return timeB - timeA;
    }

    return 0;
  });
}

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
