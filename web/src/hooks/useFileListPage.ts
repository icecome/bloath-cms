import { useState, useEffect, useMemo, useRef } from 'react';
import { scanMdFiles } from '../lib/scanner';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { getCachedFiles, setCachedFiles } from '../lib/fileCache';
import { sortByFrontMatterDate } from '../lib/sortFiles';
import { PAGE_SIZE } from '../lib/constants';
import type { RepoInfo, User } from '../../../shared/types';

interface UseFileListPageParams {
  basePath: string;
  selectedRepo: RepoInfo | null;
  user: User | null;
  enabled?: boolean;
  onError?: (err: Error) => void;
}

export function useFileListPage({
  basePath,
  selectedRepo,
  user,
  enabled = true,
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
    if (!selectedRepo || !user || !enabled) {
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

    scanMdFiles(selectedRepo, basePath)
      .then((scannedFiles) => {
        sortByFrontMatterDate(scannedFiles);
        setCachedFiles(selectedRepo, basePath, scannedFiles);
        setFiles(scannedFiles);
      })
      .catch((err: Error) => {
        if (onErrorRef.current) {
          onErrorRef.current(err);
        } else {
          console.error(`扫描路径 ${basePath} 失败:`, err);
        }
        if (!cached) setFiles([]);
      })
      .finally(() => setLoading(false));
  }, [selectedRepo, user, basePath, enabled]);

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
