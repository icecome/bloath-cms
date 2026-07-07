export interface SortableFile {
  lastModified?: number;
  name: string;
}

/**
 * 从文件名提取时间戳（支持 8 位日期和 14 位时间戳）
 * 作为后端 Commits API 失败时的降级方案
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
 * 后端通过 Commits API 获取文件的最后修改时间
 * 如果后端返回的 lastModified 为 0，则使用文件名提取时间作为降级方案
 */
export function sortByLastModified<T extends SortableFile>(files: T[]): T[] {
  return files.sort((a, b) => {
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
