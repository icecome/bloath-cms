import { getTree } from './api';
import { extractFrontMatters, type EnhancedFileItem } from './extractFrontMatter';
import {
  diffAgainstSnapshot,
  saveSnapshot,
  type SnapshotDiff,
} from './fileSnapshot';
import type { RepoInfo } from '../../../shared/types';

/**
 * 扫描结果：除最终列表外附带增量信息，供调用方做性能观测。
 * - `fromCacheCount > 0` 表示本轮有 N 个文件复用了快照元数据，未走网络。
 */
export interface ScanResult {
  files: EnhancedFileItem[];
  fromCacheCount: number;
}

/**
 * 按 basePath 过滤本轮 getTree 结果中的 md 文件。
 */
function filterMdFiles(
  allFiles: Awaited<ReturnType<typeof getTree>>,
  normalizedBase: string
): EnhancedFileItem[] {
  return allFiles
    .filter((item) => {
      if (!item.name.endsWith('.md')) return false;
      if (normalizedBase) {
        return item.path.startsWith(normalizedBase + '/') || item.path === normalizedBase;
      }
      return true;
    })
    .map((item) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      type: item.type,
      size: item.size,
      lastModified: item.lastModified
    }));
}

/**
 * 对「需要重新提取」的文件做 front-matter 提取，随后与「可复用」文件按扫描顺序合并。
 */
async function extractAndMerge(
  scanned: EnhancedFileItem[],
  diff: SnapshotDiff,
  repo: RepoInfo
): Promise<EnhancedFileItem[]> {
  if (diff.changed.length === 0) {
    // 全部命中快照：顺序与扫描结果一致
    return scanned;
  }

  // 并发提取 Front Matter 元数据（仅变更部分）
  const extracted = await extractFrontMatters(diff.changed, repo, {
    batchSize: 5,
    timeoutMs: 8000,
    maxRetries: 2,
  });

  const extractedByPath = new Map(extracted.map((f) => [f.path, f]));
  const unchangedByPath = new Map(diff.unchanged.map((f) => [f.path, f]));

  return scanned.map((file) => extractedByPath.get(file.path) ?? unchangedByPath.get(file.path) ?? file);
}

export async function scanMdFiles(
  repo: RepoInfo,
  basePath: string
): Promise<EnhancedFileItem[]> {
  const { files } = await scanMdFilesWithStats(repo, basePath);
  return files;
}

/**
 * 带增量统计的扫描：先 diff 本地快照，仅对 sha 变化的文件提取 front-matter。
 * 扫描成功即更新快照（「成功扫描 = 快照更新」的原子语义），下一轮 diff 才能命中。
 */
export async function scanMdFilesWithStats(
  repo: RepoInfo,
  basePath: string
): Promise<ScanResult> {
  const allFiles = await getTree(repo);

  const normalizedBase = basePath.replace(/^\/+|\/+$/g, '');
  const mdFiles = filterMdFiles(allFiles, normalizedBase);

  // 快照 diff：sha 未变且有元数据的文件直接复用，网络只处理变更部分
  const diff = diffAgainstSnapshot(repo, mdFiles);
  const files = await extractAndMerge(mdFiles, diff, repo);

  saveSnapshot(repo, files);

  return { files, fromCacheCount: diff.unchanged.length };
}
