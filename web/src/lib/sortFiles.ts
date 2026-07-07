export interface SortableFile {
  lastModified?: number;
  name: string;
}

/**
 * 从文件名提取时间戳（支持 8 位日期和 14 位时间戳）
 * 适用于 Hugo 博客文件名格式：YYYYMMDD-title.md 或 YYYYMMDDHHmmss-title.md
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

/**
 * 按 lastModified 降序排序（最新在前）
 * 回退策略：
 * 1. 优先使用 lastModified 字段
 * 2. 如果为 0，从文件名提取时间戳
 * 3. 如果都无法提取，保持原始顺序
 */
export function sortByLastModified<T extends SortableFile>(files: T[]): T[] {
  return files.sort((a, b) => {
    // 优先使用 lastModified，回退到文件名提取
    const timeA = a.lastModified || extractTimestampFromFilename(a.name);
    const timeB = b.lastModified || extractTimestampFromFilename(b.name);

    // 按时间降序排序
    if (timeA !== timeB) {
      return timeB - timeA;
    }

    // 时间相同时，保持原始顺序
    return 0;
  });
}
