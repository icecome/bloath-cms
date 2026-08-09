import { getTree } from './api';
import { extractFrontMatters, type EnhancedFileItem } from './extractFrontMatter';
import type { RepoInfo } from '../../../shared/types';

/**
 * 使用 GitHub Trees API 一次性获取目录树，替代递归扫描
 * 将 N 个递归请求减少为 1 个请求
 * 然后通过并发读取 Front Matter 元数据进行排序
 */
export async function scanMdFiles(
  repo: RepoInfo,
  basePath: string
): Promise<EnhancedFileItem[]> {
  const allFiles = await getTree(repo);

  const normalizedBase = basePath.replace(/^\/+|\/+$/g, '');
  const mdFiles: EnhancedFileItem[] = allFiles
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

  // 并发提取 Front Matter 元数据
  const enhancedFiles = await extractFrontMatters(mdFiles, repo, {
    batchSize: 5,
    timeoutMs: 8000,
    maxRetries: 2,
  });

  return enhancedFiles;
}