import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { moveFile, deleteFile } from '../lib/api';
import { scanMdFiles } from '../hooks/useFileList';
import { useFileListPage } from '../hooks/useFileListPage';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { clearCache } from '../lib/fileCache';
import { filterValidDirs } from '../lib/path';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import Toast from '../components/ui/Toast';
import Pagination from '../components/ui/Pagination';
import DirectorySelectorDropdown from '../components/ui/DirectorySelectorDropdown';
import FileTable from '../components/FileTable';
import { PAGE_SIZE } from '../lib/constants';
import { FileText, Search, Trash2, RotateCcw, X } from 'lucide-react';

export default function TrashPage() {
  const { user } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const trashPath = config.trashPath || '.trash';

  const {
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
  } = useFileListPage({
    basePath: trashPath,
    selectedRepo,
    user,
    onError: (err) => {
      // .trash 目录不存在是正常情况（首次使用）
      if (err.message.includes('404')) {
        console.info(`回收站目录 ${trashPath} 尚未创建`);
      } else {
        console.error(`扫描路径 ${trashPath} 失败:`, err);
      }
    },
  });

  const [restoreTarget, setRestoreTarget] = useState('');
  const [showRestoreDropdown, setShowRestoreDropdown] = useState(false);
  const [showFileRestoreDropdown, setShowFileRestoreDropdown] = useState('');
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState(false);
  const [singleDeleteFile, setSingleDeleteFile] = useState<EnhancedFileItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const availableDirs = filterValidDirs(config.paths || []);

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
    <div className="h-full flex flex-col" onClick={() => setShowFileRestoreDropdown('')}>
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

      {/* 单个文件永久删除确认弹窗 */}
      {singleDeleteFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-md shadow-sm p-4 w-full max-w-sm mx-4 border-2 border-destructive">
            <p className="text-sm text-foreground mb-4">
              确定要永久删除 {singleDeleteFile.name} 吗？<br />
              <span className="text-destructive">此操作不可恢复。</span>
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSingleDeleteFile(null)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-sm border border-border text-foreground hover:bg-accent rounded-sm transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  const file = singleDeleteFile;
                  setSingleDeleteFile(null);
                  await handlePermanentDelete(file);
                }}
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
        <div className="flex-shrink-0 px-4 md:px-8 py-4 border-b border-border-subtle">
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
      <div className="flex-1 overflow-auto px-4 md:px-8">
        {!selectedRepo ? (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="请先选择一个仓库"
          />
        ) : loading ? (
          <LoadingState />
        ) : filteredFiles.length > 0 ? (
          <FileTable
            files={paginatedFiles}
            selectedFiles={selectedFiles}
            filteredCount={filteredFiles.length}
            onSelectAll={handleSelectAll}
            onSelectFile={handleSelectFile}
            rowIcon={<Trash2 className="w-4 h-4 text-destructive flex-shrink-0" />}
            nameColumnWidth="w-[50%]"
            pathColumnWidth="w-[30%]"
            renderDesktopActions={(file) => (
              <>
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
                  onClick={() => setSingleDeleteFile(file)}
                  disabled={actionLoading}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                  title="永久删除"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
            renderMobileActions={(file) => (
              <>
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
                  onClick={() => setSingleDeleteFile(file)}
                  disabled={actionLoading}
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
          />
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
