import { useState, useEffect, useCallback, useRef } from 'react';
import { getTree } from '../lib/api';
import { getCachedFiles, setCachedFiles } from '../lib/fileCache';
import { sortByFrontMatterDate } from '../lib/sortFiles';
import { extractFrontMatters, type EnhancedFileItem } from '../lib/extractFrontMatter';
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

export function useFileList(basePath: string, selectedRepo: RepoInfo | null, enabled: boolean) {
  const [files, setFiles] = useState<EnhancedFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  // 请求 ID 计数器，用于丢弃快速切换 basePath 时的过期响应
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (silent = false) => {
    if (!selectedRepo || !enabled) {
      setFiles([]);
      return;
    }

    // 检查缓存
    const cached = getCachedFiles(selectedRepo, basePath);
    if (cached && !silent) {
      setFiles(cached as EnhancedFileItem[]);
    }

    if (!silent) setLoading(true);
    const currentRequestId = ++requestIdRef.current;
    try {
      const result = await scanMdFiles(selectedRepo, basePath);
      // 快速切换时丢弃过期响应，防止旧结果覆盖新结果
      if (requestIdRef.current !== currentRequestId) return;
      sortByFrontMatterDate(result);
      setCachedFiles(selectedRepo, basePath, result);
      setFiles(result);
    } catch (err) {
      if (requestIdRef.current !== currentRequestId) return;
      console.error(`[useFileList] 扫描路径 ${basePath} 失败:`, err);
      if (!cached) setFiles([]);
    } finally {
      if (requestIdRef.current === currentRequestId && !silent) setLoading(false);
    }
  }, [basePath, selectedRepo, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { files, loading, refresh };
}
