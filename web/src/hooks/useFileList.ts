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
  token: string,
  repo: RepoInfo,
  basePath: string
): Promise<FileItem[]> {
  // 使用 Trees API 一次性获取所有文件
  const allFiles = await getTree(token, repo);

  // 过滤出 basePath 下的 .md 文件
  const normalizedBase = basePath.replace(/^\/+|\/+$/g, '');
  return allFiles
    .filter((item) => {
      // 只保留 .md 文件
      if (!item.name.endsWith('.md')) return false;
      // 如果指定了 basePath，只保留该路径下的文件
      if (normalizedBase) {
        return item.path.startsWith(normalizedBase + '/') || item.path === normalizedBase;
      }
      return true;
    })
    .map((item) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      type: (item.type === 'blob' ? 'file' : 'dir') as 'file' | 'dir',
      size: item.size
    }));
}

export function useFileList(basePath: string, selectedRepo: RepoInfo | null, token: string | null) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!selectedRepo || !token) {
      setFiles([]);
      return;
    }

    setLoading(true);
    try {
      const files = await scanMdFiles(token, selectedRepo, basePath);
      setFiles(files);
    } catch (err) {
      console.error(`扫描路径 ${basePath} 失败:`, err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [basePath, selectedRepo, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { files, loading, refresh };
}
