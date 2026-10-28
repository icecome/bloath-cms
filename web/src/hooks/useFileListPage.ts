import { useState, useEffect, useMemo, useRef } from 'react';
import { scanMdFiles } from '../lib/scanner.ts';
import type { EnhancedFileItem } from '../lib/extractFrontMatter.ts';
import { getCachedFiles, setCachedFiles } from '../lib/fileCache.ts';
import { sortByFrontMatterDate } from '../lib/sortFiles.ts';
import { PAGE_SIZE } from '../lib/constants.ts';
import type { RepoInfo, User } from '../../../shared/types';

interface UseFileListPageParams {
  basePath: string;
  selectedRepo: RepoInfo | null;
  user: User | null;
  onError?: (err: Error) => void;
}

export function useFileListPage({
  basePath,
  selectedRepo,
  user,
  onError,
}: UseFileListPageParams) {
  const [files, setFiles] = useState<EnhancedFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!selectedRepo || !user) {
      setFiles([]);
      setCurrentPage(1);
      return;
    }

    const cached = getCachedFiles(selectedRepo, basePath);
    if (cached) {
      setFiles(cached);
    } else {
      setLoading(true);
    }

    // 扫描含 getTree + 分批提取，大仓库耗时可达数秒。
    // 期间若切换仓库/路径，旧响应必须丢弃：否则会用上一个仓库的数据覆盖当前列表，
    // 并把陈旧结果写进新仓库的缓存键。
    let cancelled = false;
    scanMdFiles(selectedRepo, basePath)
      .then((scannedFiles) => {
        if (cancelled) return;
        // sortByFrontMatterDate 非破坏性（返回新数组），必须接住返回值：
        // 旧写法 `sortByFrontMatterDate(scannedFiles);` 靠副作用调用，
        // 在排序函数改为返回副本后静默失效，列表退回 getTree 原始顺序。
        const sorted = sortByFrontMatterDate(scannedFiles);
        setCachedFiles(selectedRepo, basePath, sorted);
        setFiles(sorted);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        if (onErrorRef.current) {
          onErrorRef.current(err);
        } else {
          console.error(`扫描路径 ${basePath} 失败：`, err);
        }
        if (!cached) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedRepo, user, basePath]);

  const filteredFiles = useMemo(() =>
    files.filter((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [files, searchQuery]
  );

  const totalPages = Math.ceil(filteredFiles.length / PAGE_SIZE);
  const paginatedFiles = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredFiles.slice(start, start + PAGE_SIZE);
  }, [filteredFiles, currentPage]);

  // 当搜索变化时，重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handleSelectAll = () => {
    if (selectedFiles.size === filteredFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredFiles.map((f) => f.path)));
    }
  };

  const handleSelectFile = (path: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedFiles(newSelected);
  };

  return {
    files,
    setFiles,
    loading,
    searchQuery,
    setSearchQuery,
    currentPage,
    setCurrentPage,
    filteredFiles,
    paginatedFiles,
    totalPages,
    selectedFiles,
    setSelectedFiles,
    handleSelectAll,
    handleSelectFile,
  };
}
