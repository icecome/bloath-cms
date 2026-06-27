import { useState, useEffect, useCallback } from 'react';
import { getFiles } from '../lib/api';

export interface FileItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
}

const MAX_DEPTH = 10;

export async function scanMdFiles(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  dirPath: string,
  depth: number = 0
): Promise<FileItem[]> {
  if (depth >= MAX_DEPTH) return [];

  const items = await getFiles(token, { ...repo, path: dirPath });
  const files: FileItem[] = [];
  const dirs: string[] = [];

  for (const item of items) {
    if (item.type === 'file' && item.name.endsWith('.md')) {
      files.push(item);
    } else if (item.type === 'dir') {
      dirs.push(item.path);
    }
  }

  // 并行扫描子目录
  if (dirs.length > 0 && depth < MAX_DEPTH) {
    const subResults = await Promise.all(
      dirs.map(dir => scanMdFiles(token, repo, dir, depth + 1))
    );
    for (const subFiles of subResults) {
      files.push(...subFiles);
    }
  }

  return files;
}

export function useFileList(basePath: string, selectedRepo: any, token: string | null) {
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
