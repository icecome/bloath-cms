import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { moveFile, readFile, writeFile, deleteFile } from '../lib/api';
import { scanMdFiles, type FileItem } from '../hooks/useFileList';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import Toast from '../components/ui/Toast';
import Pagination from '../components/ui/Pagination';
import DirectorySelectorDropdown from '../components/ui/DirectorySelectorDropdown';
import {
  FileText,
  Search,
  Move,
  Trash2,
  Pencil
} from 'lucide-react';

const PAGE_SIZE = 20;

export default function DraftsPage() {
  const { token } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const navigate = useNavigate();
  const draftPath = config.draftPath || '.draft';
  const trashPath = config.trashPath || '.trash';
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [publishTarget, setPublishTarget] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; onUndo?: () => void } | null>(null);
  // 撤销记录
  const lastDeletedRef = useRef<{ files: FileItem[]; originalPaths: string[] } | null>(null);

  const availableDirs = config.paths || [];

  useEffect(() => {
    if (!selectedRepo || !token) {
      setFiles([]);
      setCurrentPage(1);
      return;
    }

    setLoading(true);
    scanMdFiles(token, selectedRepo, draftPath)
      .then(setFiles)
      .catch((err: Error) => {
        console.error(`扫描路径 ${draftPath} 失败:`, err);
        setFiles([]);
      })
      .finally(() => setLoading(false));
  }, [selectedRepo, token, draftPath]);

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

  const handleEdit = (file: FileItem) => {
    if (!selectedRepo) return;
    const relative = file.path.replace(draftPath + '/', '');
    const slug = relative.replace('.md', '');
    navigate(
      `/editor/${slug}?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}&basePath=${draftPath}`
    );
  };

  const handleNew = () => {
    if (!selectedRepo) return;
    navigate(
      `/editor/new?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}`
    );
  };

  const handlePublish = async () => {
    if (!selectedRepo || !token || selectedFiles.size === 0 || !publishTarget.trim()) return;
    setActionLoading(true);
    try {
      const filesToMove = files.filter((f) => selectedFiles.has(f.path));
      for (const file of filesToMove) {
        const newPath = `${publishTarget.trim()}/${file.name}`;
        await moveFile(token, {
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          fromPath: file.path,
          toPath: newPath,
          sha: file.sha,
          branch: selectedRepo.branch,
          message: `发布 ${file.name}`
        });
      }
      setToast({ message: `成功发布 ${filesToMove.length} 篇草稿`, type: 'success' });
      setSelectedFiles(new Set());
      setPublishTarget('');
      setShowPublishDropdown(false);
      const updatedFiles = await scanMdFiles(token, selectedRepo, draftPath);
      setFiles(updatedFiles);
    } catch (err) {
      setToast({ message: `发布失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMove = async () => {
    if (!selectedRepo || !token || selectedFiles.size === 0 || !moveTarget.trim()) return;
    setActionLoading(true);
    try {
      const filesToMove = files.filter((f) => selectedFiles.has(f.path));
      for (const file of filesToMove) {
        const newPath = `${moveTarget.trim()}/${file.name}`;
        await moveFile(token, {
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          fromPath: file.path,
          toPath: newPath,
          sha: file.sha,
          branch: selectedRepo.branch,
          message: `移动 ${file.name}`
        });
      }
      setToast({ message: `成功移动 ${filesToMove.length} 篇草稿`, type: 'success' });
      setSelectedFiles(new Set());
      setMoveTarget('');
      setShowMoveDropdown(false);
      const updatedFiles = await scanMdFiles(token, selectedRepo, draftPath);
      setFiles(updatedFiles);
    } catch (err) {
      setToast({ message: `移动失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRepo || !token || selectedFiles.size === 0) return;

    const filesToDelete = files.filter((f) => selectedFiles.has(f.path));
    const trashPaths = filesToDelete.map(f => `${trashPath}/${f.name}`);

    setActionLoading(true);
    try {
      // 批量移动到回收站
      for (let i = 0; i < filesToDelete.length; i++) {
        const file = filesToDelete[i];
        await moveFile(token, {
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          fromPath: file.path,
          toPath: trashPaths[i],
          sha: file.sha,
          branch: selectedRepo.branch,
          message: `[skip ci] 移至回收站: ${file.name}`
        });
      }

      // 记录撤销信息（批量）
      lastDeletedRef.current = { files: filesToDelete, originalPaths: filesToDelete.map(f => f.path) };

      // 从列表中移除
      setFiles(prev => prev.filter(f => !selectedFiles.has(f.path)));

      // 批量删除不显示撤销
      setToast({
        message: `已将 ${filesToDelete.length} 篇草稿移至回收站`,
        type: 'success'
      });

      setSelectedFiles(new Set());
    } catch (err) {
      setToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSingleDelete = async (file: FileItem) => {
    if (!selectedRepo || !token) return;

    const trashFile = `${trashPath}/${file.name}`;

    try {
      await moveFile(token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        fromPath: file.path,
        toPath: trashFile,
        sha: file.sha,
        branch: selectedRepo.branch,
        message: `[skip ci] 移至回收站: ${file.name}`
      });

      // 记录撤销信息
      lastDeletedRef.current = { files: [file], originalPaths: [file.path] };

      // 从列表中移除
      setFiles(prev => prev.filter(f => f.path !== file.path));

      setToast({
        message: `已将 ${file.name} 移至回收站`,
        type: 'success',
        onUndo: async () => {
          try {
            const freshToken = sessionStorage.getItem('token');
            if (!freshToken || !selectedRepo) return;
            const restoredFile = lastDeletedRef.current!.files[0];
            const originalPath = lastDeletedRef.current!.originalPaths[0];
            await moveFile(freshToken, {
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              fromPath: trashFile,
              toPath: originalPath,
              branch: selectedRepo.branch,
              message: `恢复 ${restoredFile.name}`
            });
            setFiles(prev => [...prev, restoredFile]);
            setToast({ message: '已恢复', type: 'success' });
          } catch (err) {
            setToast({ message: `恢复失败: ${(err as Error).message}`, type: 'error' });
          }
          lastDeletedRef.current = null;
        }
      });
    } catch (err) {
      setToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    }
  };

  const handleRename = async () => {
    if (!selectedRepo || !token || !renameFile || !renameValue.trim()) return;
    setActionLoading(true);
    try {
      // 读取原文件内容
      const { content: fileContent, sha } = await readFile(token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        path: renameFile.path,
        branch: selectedRepo.branch
      });

      const oldName = renameFile.name;
      const newName = `${renameValue.trim().replace(/\s+/g, '-')}.md`;
      const newDir = renameFile.path.substring(0, renameFile.path.lastIndexOf('/'));
      const newPath = `${newDir}/${newName}`;

      // 写入新文件（不修改 frontmatter）
      await writeFile(token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        path: newPath,
        content: fileContent,
        branch: selectedRepo.branch,
        message: `[skip ci] 重命名: ${oldName} -> ${newName}`
      });

      // 删除旧文件
      await deleteFile(token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        path: renameFile.path,
        sha,
        message: '[skip ci]'
      });

      setToast({ message: `重命名成功`, type: 'success' });
      setShowRenameDialog(false);
      setRenameFile(null);
      setRenameValue('');
      // 刷新列表
      const updatedFiles = await scanMdFiles(token, selectedRepo, draftPath);
      setFiles(updatedFiles);
    } catch (err) {
      setToast({ message: `重命名失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const openRenameDialog = (file: FileItem) => {
    setRenameFile(file);
    const slug = file.name.replace('.md', '');
    setRenameValue(slug);
    setShowRenameDialog(true);
  };

  return (
    <div className="flex-1 overflow-auto">
      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          onUndo={toast.onUndo}
        />
      )}

      {/* 搜索栏 + 操作工具栏 */}
      {selectedRepo && (
        <div className="px-8 py-4 border-b border-[#F2F2F2]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="搜索草稿..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md pl-9 pr-3 py-2 text-sm bg-white text-[#1F1F1F] placeholder-[#9CA3AF] border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors"
            />
          </div>

          {selectedFiles.size > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-[#6B7280] bg-[#F9FAFA] px-2.5 py-1.5 rounded-sm">
                已选 {selectedFiles.size} 篇
              </span>
              <button
                onClick={handleSelectAll}
                className="text-sm text-[#6B7280] hover:text-[#1F1F1F] hover:bg-[#F9FAFA] px-2.5 py-1.5 rounded-sm transition-colors"
              >
                {selectedFiles.size === filteredFiles.length ? '取消全选' : '全选'}
              </button>

              <div className="w-px h-4 bg-[#E8E8E8]"></div>

              {/* 发布 */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowPublishDropdown(!showPublishDropdown);
                    setShowMoveDropdown(false);
                  }}
                  disabled={actionLoading}
                  className="text-sm px-3 py-1.5 text-[#3B82F6] hover:bg-[#F9FAFA] rounded-sm transition-colors disabled:opacity-40"
                >
                  发布
                </button>
                {showPublishDropdown && (
                  <DirectorySelectorDropdown
                    availableDirs={availableDirs}
                    value={publishTarget}
                    onChange={setPublishTarget}
                    onConfirm={handlePublish}
                    confirmLabel={actionLoading ? '发布中...' : `发布 ${selectedFiles.size} 篇`}
                    onCancel={() => setShowPublishDropdown(false)}
                    disabled={actionLoading}
                    isLoading={actionLoading}
                    variant="publish"
                  />
                )}
              </div>

              {/* 移动 */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowMoveDropdown(!showMoveDropdown);
                    setShowPublishDropdown(false);
                  }}
                  disabled={actionLoading}
                  className="text-sm px-3 py-1.5 text-[#6B7280] hover:bg-[#F9FAFA] rounded-sm transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Move className="w-3.5 h-3.5" />
                  移动
                </button>
                {showMoveDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-[#E8E8E8] z-40 min-w-[220px] p-2">
                    <p className="text-sm text-[#6B7280] mb-2 px-1">移动到：</p>
                    <input
                      type="text"
                      value={moveTarget}
                      onChange={(e) => setMoveTarget(e.target.value)}
                      placeholder="输入目标路径，如 content/.draft/sub"
                      className="w-full px-2.5 py-1.5 text-sm border border-[#E8E8E8] bg-white text-[#1F1F1F] placeholder-[#9CA3AF] rounded-sm focus:outline-none focus:border-[#3B82F6] mb-2 transition-colors"
                    />
                    <button
                      onClick={handleMove}
                      disabled={!moveTarget.trim() || actionLoading}
                      className="w-full px-2.5 py-1.5 text-sm text-white bg-[#1F1F1F] rounded-sm hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionLoading ? '移动中...' : `移动 ${selectedFiles.size} 篇`}
                    </button>
                    <button
                      onClick={() => setShowMoveDropdown(false)}
                      className="w-full mt-1 px-2.5 py-1.5 text-sm text-[#6B7280] hover:bg-[#F9FAFA] rounded-sm transition-colors"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-[#E8E8E8]"></div>

              {/* 删除 */}
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="text-sm px-3 py-1.5 text-[#6B7280] hover:bg-[#F9FAFA] hover:text-[#EF4444] rounded-sm transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                删除
              </button>

              <div className="w-px h-4 bg-[#E8E8E8]"></div>

              {/* 重命名（仅选中1个文件时可用） */}
              <button
                onClick={() => {
                  const selected = files.filter(f => selectedFiles.has(f.path));
                  if (selected.length === 1) {
                    openRenameDialog(selected[0]);
                  }
                }}
                disabled={selectedFiles.size !== 1 || actionLoading}
                className="text-sm px-3 py-1.5 text-[#6B7280] hover:bg-[#F9FAFA] hover:text-[#3B82F6] rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                title="重命名"
              >
                <Pencil className="w-3.5 h-3.5" />
                重命名
              </button>
            </div>
          )}
        </div>
      )}

      {/* 文件列表 */}
      <div className="px-8">
        {!selectedRepo ? (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="请先选择一个仓库"
          />
        ) : loading ? (
          <LoadingState />
        ) : filteredFiles.length > 0 ? (
          <div>
            {/* 表头 */}
            <div className="flex items-center py-3 px-4 text-sm font-medium text-[#6B7280] bg-[#F5F6F7] border-b border-[#E8E8E8]">
              <div className="w-8 flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={selectedFiles.size === filteredFiles.length && filteredFiles.length > 0}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded-sm border-[#E8E8E8] bg-white text-[#3B82F6] focus:ring-[#3B82F6]"
                />
              </div>
              <div className="w-[40%]">文件名</div>
              <div className="w-[40%]">路径</div>
              <div className="w-[20%] text-right">操作</div>
            </div>

            {/* 列表行 */}
            {paginatedFiles.map((file) => (
              <div
                key={file.path}
                className={`flex items-center px-4 py-3.5 cursor-pointer border-b border-[#F2F2F2] transition-colors hover:bg-[#F9FAFA] ${
                  selectedFiles.has(file.path) ? 'bg-[#F9FAFA]' : ''
                }`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('input[type="checkbox"]') ||
                      (e.target as HTMLElement).closest('button')) return;
                  handleEdit(file);
                }}
              >
                {/* 多选框 */}
                <div className="w-8 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => handleSelectFile(file.path)}
                    className="w-4 h-4 rounded-sm border-[#E8E8E8] bg-white text-[#3B82F6] focus:ring-[#3B82F6]"
                  />
                </div>

                {/* 文件名 */}
                <div className="w-[40%] flex items-center gap-2.5 px-3">
                  <FileText className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
                  <span className="text-sm text-[#1F1F1F] truncate">
                    {file.name.replace('.md', '')}
                  </span>
                </div>

                {/* 路径 */}
                <div className="w-[40%] px-3">
                  <span className="text-sm text-[#6B7280] truncate block">{file.path}</span>
                </div>

                {/* 操作 */}
                <div className="w-[20%] text-right px-3 flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleEdit(file)}
                    className="text-sm text-[#3B82F6] hover:underline cursor-pointer"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleSingleDelete(file)}
                    className="text-sm text-[#6B7280] hover:text-[#EF4444] transition-colors"
                    title="移至回收站"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="暂无草稿"
            actionLabel="创建第一篇草稿"
            onAction={handleNew}
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

      {/* 重命名对话框 */}
      {showRenameDialog && renameFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRenameDialog(false)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[#1F1F1F] mb-4">重命名草稿</h3>
            <div className="mb-4">
              <label className="block text-sm text-[#6B7280] mb-2">新文件名（不含 .md）</label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E8E8E8] bg-white text-[#1F1F1F] placeholder-[#9CA3AF] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setShowRenameDialog(false);
                }}
              />
              <p className="text-xs text-[#9CA3AF] mt-1">仅修改文件名，不修改 frontmatter</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRenameDialog(false)}
                className="px-4 py-2 text-sm text-[#6B7280] hover:bg-[#F9FAFA] rounded-sm transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleRename}
                disabled={!renameValue.trim() || actionLoading}
                className="px-4 py-2 text-sm text-white bg-[#1F1F1F] rounded-sm hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {actionLoading ? '处理中...' : '确认重命名'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
