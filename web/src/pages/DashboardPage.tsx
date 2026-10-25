import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { commitBatch } from '../lib/api';
import { buildCommitMessage } from '../lib/deploySettings';
import { useFileListPage } from '../hooks/useFileListPage';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { clearCache } from '../lib/fileCache';
import { filterValidDirs, dedupeTargetPaths } from '../lib/path';
import { buildEditUrl } from '../lib/navigation';
import { readUndoRecord, writeUndoRecord, clearUndoRecord } from '../lib/undoStore';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import Pagination from '../components/ui/Pagination';
import FileTable from '../components/FileTable';
import { PAGE_SIZE } from '../lib/constants';
import { FileText, Search, Trash2, Pencil, Folder } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

export default function DashboardPage() {
  const { user } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addToast } = useToast();
  const trashPath = config.trashPath || '.trash';

  // 当前展示目录：优先 URL path 参数，未指定或非法时默认第一个有效路径
  const validPaths = useMemo(() => filterValidDirs(config.paths || []), [config.paths]);
  const pathParam = searchParams.get('path');
  const currentDir = pathParam && validPaths.includes(pathParam) ? pathParam : (validPaths[0] || '');

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
    basePath: currentDir,
    // useFileListPage 无 enabled 参数：未配置内容路径时把 selectedRepo 置空，
    // 使 hook 走「无仓库」分支（清空列表、不发起扫描），
    // 等价于旧实现的 if (!currentDir) { setFiles([]); return; } 守卫
    selectedRepo: currentDir ? selectedRepo : null,
    user,
    onError: (err) => {
      console.error('加载文件列表失败：', err);
    },
  });

  const [actionLoading, setActionLoading] = useState(false);
  // 同步动作锁：actionLoading 是 state，同一事件循环内的第二次点击读到的仍是旧值，
  // 无法阻止双击重复提交。ref 的读写是同步的，可堵住该窗口（与 DraftsPage 一致）。
  const actionLockRef = useRef(false);

  /** 获取动作锁；已被占用时返回 false，调用方应立即返回 */
  const acquireActionLock = useCallback((): boolean => {
    if (actionLockRef.current) return false;
    actionLockRef.current = true;
    return true;
  }, []);
  const releaseActionLock = useCallback((): void => {
    actionLockRef.current = false;
  }, []);

  // 切换目录时，重置到第一页并清空多选，避免残留页码/选中导致误操作
  useEffect(() => {
    setCurrentPage(1);
    setSelectedFiles(new Set());
  }, [currentDir, setCurrentPage, setSelectedFiles]);

  const handleEdit = (file: EnhancedFileItem) => {
    if (!selectedRepo || !currentDir) return;
    const relative = file.path.slice(currentDir.length + 1);
    navigate(buildEditUrl({
      owner: selectedRepo.owner,
      repo: selectedRepo.repo,
      branch: selectedRepo.branch,
      basePath: currentDir,
      filePath: relative,
      returnTo: currentDir
    }));
  };

  const handleNew = () => {
    if (!selectedRepo) return;
    navigate(`/editor/new?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}`);
  };

  // 单篇移至回收站：move 到回收站目录（skipCi 合并为单提交），
  // 撤销走 undoStore（sessionStorage，TTL 60s，键含 branch）
  const handleDelete = async (file: EnhancedFileItem) => {
    if (!selectedRepo || !user) return;
    if (!acquireActionLock()) return;
    setActionLoading(true);

    const trashFile = `${trashPath}/${file.name}`;

    try {
      await commitBatch({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
        message: buildCommitMessage(`移至回收站：${file.name}`, { skipCi: true }),
        ops: [{ op: 'move', fromPath: file.path, path: trashFile }],
        userName: user?.login
      });

      setFiles(prev => prev.filter(f => f.path !== file.path));
      clearCache(selectedRepo);

      // 撤销记录含 branch（M-R4 教训）：恢复前二次比对，跨分支不执行旧路径移动
      writeUndoRecord<EnhancedFileItem>(
        selectedRepo,
        { files: [file], originalPaths: [file.path], deletedAt: Date.now(), branch: selectedRepo.branch },
        sessionStorage
      );

      addToast({
        message: `已将 ${file.name} 移至回收站`,
        type: 'success',
        duration: 0, // 撤销类 toast 不自动关闭（P1-003）
        onUndo: async () => {
          try {
            if (!selectedRepo) return;
            const record = readUndoRecord<EnhancedFileItem>(selectedRepo, sessionStorage);
            // 二次比对分支（M-R4）：分支不一致（含旧格式无 branch 记录）一律放弃恢复
            if (!record || record.branch !== selectedRepo.branch) return;
            const originalPath = record.originalPaths[0];
            const restoredFile = record.files[0];
            if (!originalPath || !restoredFile) return;
            await commitBatch({
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              branch: selectedRepo.branch,
              message: buildCommitMessage(`恢复 ${restoredFile.name}`),
              ops: [{ op: 'move', fromPath: trashFile, path: originalPath }],
              userName: user?.login
            });
            setFiles(prev => [...prev, restoredFile]);
            clearUndoRecord(selectedRepo, sessionStorage);
            clearCache(selectedRepo);
            addToast({ message: '已恢复', type: 'success' });
          } catch (err) {
            addToast({ message: `恢复失败：${(err as Error).message}`, type: 'error' });
          }
        }
      });
    } catch (err) {
      addToast({ message: `删除失败：${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
      releaseActionLock();
    }
  };

  // 批量移至回收站：合并为单 commit（skipCi），
  // 撤销记录存 undoStore（sessionStorage，TTL 60s，键含 branch）
  const handleBatchDelete = async () => {
    if (!selectedRepo || !user || selectedFiles.size === 0) return;
    const filesToDelete = files.filter((f) => selectedFiles.has(f.path));
    if (filesToDelete.length === 0) return;
    // 锁在参数校验之后获取：校验失败路径直接返回，不会持有锁
    if (!acquireActionLock()) return;

    setActionLoading(true);
    try {
      // 同名文件移入回收站时去重目标名，避免覆盖丢失
      const targets = dedupeTargetPaths(filesToDelete.map((f) => `${trashPath}/${f.name}`));
      await commitBatch({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
        message: buildCommitMessage(`移至回收站：${filesToDelete.length} 篇文章`, { skipCi: true }),
        ops: filesToDelete.map((f, i) => ({
          op: 'move',
          fromPath: f.path,
          path: targets[i] ?? `${trashPath}/${f.name}`
        })),
        userName: user?.login
      });
      setFiles((prev) => prev.filter((f) => !selectedFiles.has(f.path)));
      clearCache(selectedRepo);

      addToast({
        message: `已将 ${filesToDelete.length} 篇文章移至回收站`,
        type: 'success',
        duration: 0, // 撤销类 toast 不自动关闭（P1-003）
        onUndo: async () => {
          try {
            if (!selectedRepo) return;
            const record = readUndoRecord<EnhancedFileItem>(selectedRepo, sessionStorage);
            // 二次比对分支（M-R4）：分支不一致（含旧格式无 branch 记录）一律放弃恢复
            if (!record || record.branch !== selectedRepo.branch) return;
            // 恢复目标同样去重（防御性，原路径本身互异）；
            // 回收站来源路径必须按删除时的同名去重规则重算——
            // 直接拼 `${trashPath}/${f.name}` 会指向不存在的非去重名，导致整批恢复失败
            const restoreTargets = dedupeTargetPaths(record.originalPaths);
            const trashSources = dedupeTargetPaths(record.files.map((f) => `${trashPath}/${f.name}`));
            await commitBatch({
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              branch: selectedRepo.branch,
              message: buildCommitMessage(`撤销删除：恢复 ${record.files.length} 篇文章`, { skipCi: true }),
              ops: record.files.map((f, i) => ({
                op: 'move' as const,
                fromPath: trashSources[i] ?? `${trashPath}/${f.name}`,
                path: restoreTargets[i] ?? record.originalPaths[i] ?? `${trashPath}/${f.name}`
              })),
              userName: user?.login
            });
            setFiles((prev) => [...prev, ...record.files]);
            clearUndoRecord(selectedRepo, sessionStorage);
            clearCache(selectedRepo);
            addToast({ message: '已恢复全部文章', type: 'success' });
          } catch (err) {
            addToast({ message: `恢复失败：${(err as Error).message}`, type: 'error' });
          }
        }
      });

      // 撤销记录在 toast 之后写入：onUndo 点击时才读取，写入顺序不影响语义
      // （与 DraftsPage 批量删除一致）
      writeUndoRecord<EnhancedFileItem>(
        selectedRepo,
        {
          files: filesToDelete,
          originalPaths: filesToDelete.map((f) => f.path),
          deletedAt: Date.now(),
          branch: selectedRepo.branch
        },
        sessionStorage
      );

      setSelectedFiles(new Set());
    } catch (err) {
      addToast({ message: `删除失败：${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
      releaseActionLock();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {selectedRepo && (
        <>
        <div className="flex-shrink-0 px-4 md:px-8 py-4 flex items-center gap-3 border-b border-border-subtle">
          {currentDir && (
            <div className="flex items-center gap-1.5 text-sm text-foreground bg-accent px-2.5 py-1.5 rounded-sm whitespace-nowrap max-w-[40%]">
              <Folder className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="font-medium truncate">{currentDir}</span>
            </div>
          )}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="按文件名或路径筛选……"
              aria-label="按文件名或路径筛选"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted text-foreground placeholder-muted-foreground border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            />
          </div>
        </div>

        {/* 批量操作工具栏：置于表格上方，与 TrashPage 同层 */}
        {selectedFiles.size > 0 && (
          <div className="flex-shrink-0 px-4 md:px-8 py-2.5 border-b border-border-subtle flex items-center gap-2 flex-wrap bg-accent/40">
            <span className="text-sm text-muted-foreground bg-background px-2.5 py-1.5 rounded-sm">
              已选 {selectedFiles.size} 篇
            </span>
            <button
              onClick={handleSelectAll}
              className="text-sm text-muted-foreground hover:text-foreground hover:bg-background px-2.5 py-1.5 rounded-sm transition-colors"
            >
              {selectedFiles.size === filteredFiles.length ? '取消全选' : '全选'}
            </button>
            <button
              onClick={() => setSelectedFiles(new Set())}
              className="text-sm text-muted-foreground hover:text-foreground hover:bg-background px-2.5 py-1.5 rounded-sm transition-colors"
            >
              取消选择
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={actionLoading}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 text-white bg-destructive hover:bg-destructive/90 rounded-sm transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {actionLoading ? '处理中……' : '移至回收站'}
            </button>
          </div>
        )}
        </>
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
            onRowClick={handleEdit}
            rowIcon={<span className="w-2.5 h-2.5 rounded-full bg-success flex-shrink-0" />}
            nameColumnWidth="w-[40%]"
            pathColumnWidth="w-[40%]"
            renderDesktopActions={(file) => (
              <>
                <button
                  onClick={() => handleEdit(file)}
                  className="text-sm text-primary-text hover:underline cursor-pointer whitespace-nowrap"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(file)}
                  disabled={actionLoading}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 shrink-0"
                  title="移至回收站"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            renderMobileActions={(file) => (
              <>
                <button
                  onClick={() => handleEdit(file)}
                  className="p-1.5 text-primary-text hover:bg-accent rounded transition-colors"
                  title="编辑"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(file)}
                  disabled={actionLoading}
                  className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-accent rounded transition-colors disabled:opacity-40"
                  title="移至回收站"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          />
        ) : !currentDir ? (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="未配置内容路径"
            description="请先在设置中添加内容路径"
            actionLabel="去设置"
            onAction={() => navigate('/settings')}
          />
        ) : (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="暂无内容"
            description={`目录 ${currentDir} 下暂无文章`}
            actionLabel="创建第一篇文章"
            onAction={handleNew}
          />
        )}
      </div>

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
