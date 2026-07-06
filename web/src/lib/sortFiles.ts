export interface SortableFile {
  lastModified?: number;
}

/**
 * 按 lastModified 降序排序（最新在前）
 * 未设置 lastModified 的文件排在末尾
 */
export function sortByLastModified<T extends SortableFile>(files: T[]): T[] {
  return files.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
}
