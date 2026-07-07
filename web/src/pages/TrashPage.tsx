import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { moveFile, deleteFile } from '../lib/api';
import { scanMdFiles } from '../hooks/useFileList';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { getCachedFiles, setCachedFiles, clearCache } from '../lib/fileCache';
import { sortByFrontMatterDate } from '../lib/sortFiles';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import Toast from '../components/ui/Toast';
import Pagination from '../components/ui/Pagination';
import DirectorySelectorDropdown from '../components/ui/DirectorySelectorDropdown';
import { PAGE_SIZE } from '../lib/constants';
import { FileText, Search, Trash2, RotateCcw, X } from 'lucide-react';

export default function TrashPage() {
  const { user } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const trashPath = config.trashPath || '.trash';
  const [files, setFiles] = useState<EnhancedFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [restoreTarget, setRestoreTarget] = useState('');
  const [showRestoreDropdown, setShowRestoreDropdown] = useState(false);
  const [showFileRestoreDropdown, setShowFileRestoreDropdown] = useState('');
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const availableDirs = config.paths || [];

  useEffect(() => {
    if (!selectedRepo || !user) {
      setFiles([]);
      setCurrentPage(1);
      return;
    }

    // 先尝试从缓存加载
    const cached = getCachedFiles(selectedRepo, trashPath);
    if (cached) {
      setFiles(cached);
    } else {
      setLoading(true);
    }

    // 后台刷新
    scanMdFiles(selectedRepo, trashPath)
      .then(files => {
        sortByFrontMatterDate(files);
        setCachedFiles(selectedRepo, trashPath, files);
        setFiles(files);
      })
      .catch((err: Error) => {
        // .trash 目录不存在是正常情况（首次使用）
        if (err.message.includes('404')) {
          console.info(`回收站目录 ${trashPath} 尚未创建`);
          if (!cached) setFiles([]);
        } else {
          console.error(`扫描路径 ${trashPath} 失败:`, err);
          if (!cached) setFiles([]);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedRepo, user, trashPath]);

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

  const handleRestore = async (file: EnhancedFileItem, targetDir: string) => {
    if (!selectedRepo || !user || !targetDir.trim()) return;
    if (!file.sha) {
      setToast({ message: '文件缺少 SHA，无法恢复', type: 'error' });
      return;
    }
    setActionLoading(true);
    try {
      const newPath = `${targetDir.trim()}/${file.name}`;
      await moveFile({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        fromPath: file.path,
        toPath: newPath,
        sha: file.sha,
        branch: selectedRepo.branch,
        message: `恢复 ${file.name}`,
        userName: user?.login
      });
      setToast({ message: `已将 ${file.name} 移动到 ${targetDir}`, type: 'success' });
      clearCache(selectedRepo);
      const updatedFiles = await scanMdFiles(selectedRepo, trashPath).catch(() => [] as EnhancedFileItem[]);
      setFiles(updatedFiles);
    } catch (err) {
      setToast({ message: `恢复失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePermanentDelete = async (file: EnhancedFileItem) => {
    if (!selectedRepo || !user) return;
    setActionLoading(true);
    try {
      await deleteFile({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        path: file.path,
        sha: file.sha,
        message: '[skip ci]',
        userName: user?.login
      });
      setToast({ message: `已永久删除 ${file.name}`, type: 'success' });
      const updatedFiles = await scanMdFiles(selectedRepo, trashPath).catch(() => [] as EnhancedFileItem[]);
      setFiles(updatedFiles);
    } catch (err) {
      setToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkRestore = async () => {
    if (!selectedRepo || !user || selectedFiles.size === 0 || !restoreTarget.trim()) return;
    setActionLoading(true);
    try {
      const filesToRestore = files.filter((f) => selectedFiles.has(f.path));
      for (const file of filesToRestore) {
        const newPath = `${restoreTarget.trim()}/${file.name}`;
        await moveFile({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          fromPath: file.path,
          toPath: newPath,
          sha: file.sha,
          branch: selectedRepo.branch,
          message: `恢复 ${file.name}`,
          userName: user?.login
        });
      }
      setToast({ message: `已恢复 ${filesToRestore.length} 个文件`, type: 'success' });
      setSelectedFiles(new Set());
      setRestoreTarget('');
      setShowRestoreDropdown(false);
      const updatedFiles = await scanMdFiles(selectedRepo, trashPath).catch(() => [] as EnhancedFileItem[]);
      setFiles(updatedFiles);
    } catch (err) {
      setToast({ message: `恢复失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkPermanentDelete = async () => {
    if (!selectedRepo || !user || selectedFiles.size === 0) return;
    setActionLoading(true);
    try {
      const filesToDelete = files.filter((f) => selectedFiles.has(f.path));
      let deletedCount = 0;
      const errors: string[] = [];
      for (const file of filesToDelete) {
        try {
          await deleteFile({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            path: file.path,
            sha: file.sha,
            message: '[skip ci]',
            userName: user?.login
          });
          deletedCount++;
        } catch (err) {
          errors.push(`${file.name}: ${(err as Error).message}`);
        }
      }
      if (deletedCount > 0) {
        setToast({ message: `已永久删除 ${deletedCount} 个文件`, type: 'success' });
      }
      if (errors.length > 0) {
        setToast({ message: `部分删除失败: ${errors.join('; ')}`, type: 'error' });
      }
      setSelectedFiles(new Set());
      setPermanentDeleteConfirm(false);
      const updatedFiles = await scanMdFiles(selectedRepo, trashPath).catch(() => [] as EnhancedFileItem[]);
      setFiles(updatedFiles);
    } catch (err) {
      setToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto" onClick={() => setShowFileRestoreDropdown('')}>
      {/* Toast */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* 永久删除确认弹窗 */}
      {permanentDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-md shadow-sm p-4 w-full max-w-sm mx-4 border-2 border-destructive">
            <p className="text-sm text-foreground mb-4">
              确定要永久删除选中的 {selectedFiles.size} 个文件吗？<br />
              <span className="text-destructive">此操作不可恢复。</span>
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPermanentDeleteConfirm(false)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-sm border border-border text-foreground hover:bg-accent rounded-sm transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleBulkPermanentDelete}
                disabled={actionLoading}
                className="px-3 py-1.5 text-sm text-white bg-destructive hover:bg-destructive/90 rounded-sm transition-colors disabled:opacity-40"
              >
                {actionLoading ? '删除中...' : '永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 搜索栏 + 操作工具栏 */}
      {selectedRepo && (
        <div className="px-4 md:px-8 py-4 border-b border-border-subtle">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索回收站..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md pl-9 pr-3 py-2 text-sm bg-card text-foreground placeholder-muted-foreground border border-border rounded-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {selectedFiles.size > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground bg-accent px-2.5 py-1.5 rounded-sm">
                已选 {selectedFiles.size} 个
              </span>
              <button
                onClick={handleSelectAll}
                className="text-sm text-muted-foreground hover:text-foreground hover:bg-accent px-2.5 py-1.5 rounded-sm transition-colors"
              >
                {selectedFiles.size === filteredFiles.length ? '取消全选' : '全选'}
              </button>

              <div className="w-px h-4 bg-border"></div>

              {/* 恢复 */}
              <div className="relative">
                <button
                  onClick={() => setShowRestoreDropdown(!showRestoreDropdown)}
                  disabled={actionLoading}
                  className="text-sm px-3 py-1.5 text-primary hover:bg-accent rounded-sm transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  恢复
                </button>
                {showRestoreDropdown && (
                  <DirectorySelectorDropdown
                    availableDirs={availableDirs}
                    value={restoreTarget}
                    onChange={setRestoreTarget}
                    onConfirm={handleBulkRestore}
                    confirmLabel={actionLoading ? '恢复中...' : `恢复 ${selectedFiles.size} 个`}
                    onCancel={() => setShowRestoreDropdown(false)}
                    disabled={actionLoading}
                    isLoading={actionLoading}
                    variant="restore"
                  />
                )}
              </div>

              <div className="w-px h-4 bg-border"></div>

              {/* 永久删除 */}
              <button
                onClick={() => setPermanentDeleteConfirm(true)}
                disabled={actionLoading}
                className="text-sm px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-destructive rounded-sm transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                永久删除
              </button>
            </div>
          )}
        </div>
      )}

      {/* 文件列表 */}
      <div className="px-4 md:px-8">
        {!selectedRepo ? (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="请先选择一个仓库"
          />
        ) : loading ? (
          <LoadingState />
        ) : filteredFiles.length > 0 ? (
          <div>
            {/* 桌面端表头 */}
            <div className="hidden md:flex items-center py-3 px-4 text-sm font-medium text-muted-foreground bg-accent border-b border-border">
              <div className="w-8 flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={selectedFiles.size === filteredFiles.length && filteredFiles.length > 0}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded-sm border-border bg-card text-primary focus:ring-primary"
                />
              </div>
              <div className="w-[50%]">文件名</div>
              <div className="w-[30%]">路径</div>
              <div className="w-[20%] text-right">操作</div>
            </div>

            {/* 列表 */}
            {paginatedFiles.map((file) => (
              <div
                key={file.path}
                className={`flex items-center px-4 py-3.5 border-b border-border-subtle transition-colors hover:bg-accent ${
                  selectedFiles.has(file.path) ? 'bg-accent' : ''
                }`}
              >
                {/* 桌面端：表格行 */}
                <div className="hidden md:flex items-center w-8 justify-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => handleSelectFile(file.path)}
                    className="w-4 h-4 rounded-sm border-border bg-card text-primary focus:ring-primary"
                  />
                </div>
                <div className="hidden md:flex items-center w-[50%] gap-2.5 px-3">
                  <Trash2 className="w-4 h-4 text-destructive flex-shrink-0" />
                  <span className="text-sm text-foreground truncate">{file.name.replace('.md', '')}</span>
                </div>
                <div className="hidden md:block w-[30%] px-3">
                  <span className="text-sm text-muted-foreground truncate block">{file.path}</span>
                </div>
                <div className="hidden md:flex w-[20%] items-center justify-end gap-2 px-3">
                  <div className="relative inline-block">
                    <button
                      onClick={() => {
                        if (showFileRestoreDropdown === file.path) {
                          setShowFileRestoreDropdown('');
                        } else {
                          setShowFileRestoreDropdown(file.path);
                        }
                      }}
                      className="text-sm text-primary hover:underline cursor-pointer"
                      title="恢复到指定目录"
                    >
                      恢复
                    </button>
                    {showFileRestoreDropdown === file.path && (
                      <div
                        className="absolute right-0 top-full mt-1 bg-card border border-border z-50 max-h-[200px] overflow-y-auto p-2"
                        style={{ maxWidth: 'calc(100vw - 320px)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {availableDirs.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-2 py-1">暂无可用目录</p>
                        ) : (
                          availableDirs.map((dir) => (
                            <button
                              key={dir}
                              onClick={() => {
                                handleRestore(file, dir);
                                setShowFileRestoreDropdown('');
                              }}
                              className="w-full text-left text-sm px-2.5 py-1.5 hover:bg-accent transition-colors text-foreground truncate"
                            >
                              {dir}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handlePermanentDelete(file)}
                    disabled={actionLoading}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                    title="永久删除"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* 移动端：卡片布局 */}
                <div className="flex md:hidden flex-1 min-w-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => handleSelectFile(file.path)}
                    className="w-4 h-4 rounded-sm border-border bg-card text-primary focus:ring-primary flex-shrink-0"
                  />
                  <Trash2 className="w-4 h-4 text-destructive flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {file.name.replace('.md', '')}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {file.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <div className="relative inline-block">
                      <button
                        onClick={() => {
                          if (showFileRestoreDropdown === file.path) {
                            setShowFileRestoreDropdown('');
                          } else {
                            setShowFileRestoreDropdown(file.path);
                          }
                        }}
                        className="p-1.5 text-primary hover:bg-accent rounded transition-colors"
                        title="恢复"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      {showFileRestoreDropdown === file.path && (
                        <div
                          className="absolute right-0 top-full mt-1 bg-card border border-border z-50 max-h-[200px] overflow-y-auto p-2 w-48"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {availableDirs.length === 0 ? (
                            <p className="text-xs text-muted-foreground px-2 py-1">暂无可用目录</p>
                          ) : (
                            availableDirs.map((dir) => (
                              <button
                                key={dir}
                                onClick={() => {
                                  handleRestore(file, dir);
                                  setShowFileRestoreDropdown('');
                                }}
                                className="w-full text-left text-sm px-2.5 py-1.5 hover:bg-accent transition-colors text-foreground truncate"
                              >
                                {dir}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handlePermanentDelete(file)}
                      disabled={actionLoading}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="回收站为空"
          />
        )}
      </div>

      {/* 分页 */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={filteredFiles.length}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => setCurrentPage(page)}
      />
    </div>
  );
}
