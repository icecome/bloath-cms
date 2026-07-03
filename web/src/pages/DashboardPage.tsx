import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { moveFile } from '../lib/api';
import { scanMdFiles } from '../hooks/useFileList';
import type { FileItem } from '../hooks/useFileList';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import Toast from '../components/ui/Toast';
import Pagination from '../components/ui/Pagination';
import { FileText, Search, Trash2, Pencil } from 'lucide-react';

const PAGE_SIZE = 20;

export default function DashboardPage() {
  const { token } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const navigate = useNavigate();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; onUndo?: () => void } | null>(null);
  // 撤销记录
  const lastDeletedRef = useRef<{ file: FileItem; originalPath: string } | null>(null);

  useEffect(() => {
    if (!selectedRepo || !token) {
      setFiles([]);
      setCurrentPage(1);
      return;
    }

    setLoading(true);
    const paths = (config.paths || []).filter(p => !p.includes('*') && p.trim() !== '');

    // 并行扫描所有顶层路径
    Promise.all(paths.map(p => scanMdFiles(token, selectedRepo, p)))
      .then(results => setFiles(results.flat()))
      .finally(() => setLoading(false));
  }, [selectedRepo, token, config]);

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

  const handleEdit = (file: FileItem) => {
    if (!selectedRepo) return;
    const paths = config.paths || [];
    let relative = file.path;
    let foundBasePath = '';
    for (const path of paths) {
      if (relative.startsWith(path + '/')) {
        relative = relative.slice(path.length + 1);
        foundBasePath = path;
        break;
      }
    }
    const slug = relative.replace('.md', '');
    navigate(`/editor/${slug}?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}&basePath=${encodeURIComponent(foundBasePath)}`);
  };

  const handleNew = () => {
    if (!selectedRepo) return;
    navigate(`/editor/new?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}`);
  };

  const handleDelete = async (file: FileItem) => {
    if (!selectedRepo || !token) return;

    const trashPath = `${config.trashPath || '.trash'}/${file.name}`;

    try {
      await moveFile(token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        fromPath: file.path,
        toPath: trashPath,
        sha: file.sha,
        branch: selectedRepo.branch,
        message: `[skip ci] 移至回收站: ${file.name}`
      });

      // 记录撤销信息
      lastDeletedRef.current = { file, originalPath: file.path };

      // 从列表中移除
      setFiles(prev => prev.filter(f => f.path !== file.path));

      setToast({
        message: `已将 ${file.name} 移至回收站`,
        type: 'success',
        onUndo: async () => {
          try {
            // 重新从 sessionStorage 获取最新 token
            const freshToken = sessionStorage.getItem('token');
            if (!freshToken || !selectedRepo) return;
            await moveFile(freshToken, {
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              fromPath: trashPath,
              toPath: lastDeletedRef.current!.originalPath,
              branch: selectedRepo.branch,
              message: `恢复 ${file.name}`
            });
            setFiles(prev => [...prev, lastDeletedRef.current!.file]);
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

      {/* 筛选栏 */}
      {selectedRepo && (
        <div className="px-4 md:px-8 py-4 flex items-center justify-between border-b border-[#F2F2F2]">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="按文件名或提交信息筛选..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white text-[#1F1F1F] placeholder-[#9CA3AF] border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors"
            />
          </div>
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
            <div className="hidden md:flex items-center py-3 px-4 text-sm font-medium text-[#6B7280] bg-[#F5F6F7] border-b border-[#E8E8E8]">
              <div className="w-[40%]">文件名</div>
              <div className="w-[40%]">提交路径</div>
              <div className="w-[20%] text-right">操作</div>
            </div>

            {/* 列表 */}
            {paginatedFiles.map((file) => (
              <div
                key={file.path}
                className="flex items-center px-4 py-3.5 cursor-pointer border-b border-[#F2F2F2] transition-colors hover:bg-[#F9FAFA]"
                onClick={() => handleEdit(file)}
              >
                {/* 桌面端：表格行 */}
                <div className="hidden md:flex items-center w-[40%] gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#22C55E] flex-shrink-0" />
                  <span className="text-sm font-medium text-[#1F1F1F] truncate">
                    {file.name.replace('.md', '')}
                  </span>
                </div>
                <div className="hidden md:block w-[40%]">
                  <span className="text-sm text-[#6B7280]">{file.path}</span>
                </div>
                <div className="hidden md:flex w-[20%] items-center justify-end gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(file);
                    }}
                    className="text-sm text-[#3B82F6] hover:underline"
                  >
                    编辑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(file);
                    }}
                    className="text-[#6B7280] hover:text-[#EF4444] transition-colors"
                    title="移至回收站"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* 移动端：卡片布局 */}
                <div className="flex md:hidden flex-1 min-w-0 items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#22C55E] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#1F1F1F] truncate">
                      {file.name.replace('.md', '')}
                    </div>
                    <div className="text-xs text-[#9CA3AF] truncate mt-0.5">
                      {file.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(file);
                      }}
                      className="p-1.5 text-[#3B82F6] hover:bg-[#EFF6FF] rounded transition-colors"
                      title="编辑"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(file);
                      }}
                      className="p-1.5 text-[#6B7280] hover:text-[#EF4444] hover:bg-[#FEF2F2] rounded transition-colors"
                      title="移至回收站"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="暂无内容"
            actionLabel="创建第一篇文章"
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
    </div>
  );
}
