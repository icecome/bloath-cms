import { useState, useEffect, useCallback } from 'react';
import { getTree } from '../lib/api';

export interface FileItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
}

export interface RepoInfo {
  owner: string;
  repo: string;
  branch: string;
}

/**
 * 使用 GitHub Trees API 一次性获取目录树，替代递归扫描
 * 将 N 个递归请求减少为 1 个请求
 */
export async function scanMdFiles(
  repo: RepoInfo,
  basePath: string
): Promise<FileItem[]> {
  const allFiles = await getTree(repo);

  const normalizedBase = basePath.replace(/^\/+|\/+$/g, '');
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
      size: item.size
    }));
}

export function useFileList(basePath: string, selectedRepo: RepoInfo | null, enabled: boolean) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!selectedRepo || !enabled) {
      setFiles([]);
      return;
    }

    setLoading(true);
    try {
      const result = await scanMdFiles(selectedRepo, basePath);
      setFiles(result);
    } catch (err) {
      console.error(`扫描路径 ${basePath} 失败:`, err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [basePath, selectedRepo, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { files, loading, refresh };
}
