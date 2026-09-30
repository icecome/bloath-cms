// 草稿列表与缓冲清单合并：以草稿路径为范围，缓冲项作为「未发布」变体并入
import type { BufferChangeItem } from './bufferApi';
import type { EnhancedFileItem, FileSource } from './extractFrontMatter';

/**
 * 合并规则（缓冲优先）：
 * - 仓库有、缓冲无           → 仓库
 * - 仓库有、缓冲 write 同路径 → 缓冲·有改动（内容以缓冲为准）
 * - 仓库无、缓冲 write       → 缓冲
 * - 缓冲 delete             → 仓库项标为 缓冲·待删除（无对应仓库项时忽略）
 * - 缓冲 move（目标在草稿范围内）→ 视作目标路径的缓冲项
 */
export function mergeDraftList(
  repoFiles: readonly EnhancedFileItem[],
  bufferChanges: readonly BufferChangeItem[],
  basePath: string
): EnhancedFileItem[] {
  const normalizedBase = basePath.replace(/^\/+|\/+$/g, '');
  const inScope = (p: string) =>
    normalizedBase ? p.startsWith(normalizedBase + '/') || p === normalizedBase : true;

  const result = new Map<string, EnhancedFileItem>();
  for (const f of repoFiles) {
    result.set(f.path, { ...f, source: 'repo' as FileSource });
  }

  // 待删除与移动的源路径需先记录，避免后续被 write 覆盖判定
  const deletedPaths = new Set<string>();

  for (const c of bufferChanges) {
    if (c.op === 'delete' && inScope(c.path) && result.has(c.path)) {
      deletedPaths.add(c.path);
    }
  }

  for (const c of bufferChanges) {
    if (!inScope(c.path)) continue;

    if (c.op === 'write') {
      if (deletedPaths.has(c.path)) continue;
      const existed = result.has(c.path);
      const prev = result.get(c.path);
      result.set(c.path, {
        name: c.path.split('/').pop() || c.path,
        path: c.path,
        sha: prev?.sha || '',
        type: 'file',
        frontmatter: prev?.frontmatter,
        sortDate: prev?.sortDate ?? c.savedAt,
        lastModified: c.savedAt,
        source: existed ? ('buffer-modified' as FileSource) : ('buffer' as FileSource),
        publishTarget: c.publishTarget,
      });
    } else if (c.op === 'move') {
      // 源位置标记待删除；目标位置若在草稿范围内则并入
      if (inScope(c.path) && result.has(c.path)) deletedPaths.add(c.path);
      if (inScope(c.path) && !result.has(c.path)) {
        result.set(c.path, {
          name: c.path.split('/').pop() || c.path,
          path: c.path,
          sha: '',
          type: 'file',
          sortDate: c.savedAt,
          lastModified: c.savedAt,
          source: 'buffer' as FileSource,
          publishTarget: c.publishTarget,
        });
      }
    }
  }

  // 待删除项保留在列表中，供用户确认或撤销
  for (const p of deletedPaths) {
    const item = result.get(p);
    if (item) result.set(p, { ...item, source: 'buffer-deleted' as FileSource });
  }

  const items = Array.from(result.values());
  items.sort((a, b) => (b.sortDate ?? b.lastModified ?? 0) - (a.sortDate ?? a.lastModified ?? 0));
  return items;
}
