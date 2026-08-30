import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { moveFile } from '../lib/api';
import { scanMdFiles } from '../lib/scanner';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { getCachedFiles, setCachedFiles, clearCache } from '../lib/fileCache';
import { sortByFrontMatterDate } from '../lib/sortFiles';
import { filterValidDirs } from '../lib/path';
import { buildEditUrl } from '../lib/navigation';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import Pagination from '../components/ui/Pagination';
import { FileText, Search, Trash2, Pencil, Folder } from 'lucide-react';
import { PAGE_SIZE, UNDO_STORAGE_PREFIX, UNDO_TTL_MS } from '../lib/constants';
import { useToast } from '../contexts/ToastContext';

function getUndoKey(repo: { owner: string; repo: string }) {
  return `${UNDO_STORAGE_PREFIX}_${repo.owner}_${repo.repo}`;
}

interface UndoRecord {
  file: EnhancedFileItem;
  originalPath: string;
  deletedAt: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const navigate = useNavigate();
const [searchParams] = useSearchParams();
  const { addToast } = useToast();
  const [files, setFiles] = useState<EnhancedFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const lastDeletedRef = useRef<{ file: EnhancedFileItem; originalPath: string } | null>(null);
  const undoCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 当前展示目录：优先 URL path 参数，未指定或非法时默认第一个有效路径
  const validPaths = useMemo(() => filterValidDirs(config.paths || []), [config.paths]);
  const pathParam = searchParams.get('path');
  const currentDir = pathParam && validPaths.includes(pathParam) ? pathParam : (validPaths[0] || '');

  useEffect(() => {
    if (!selectedRepo || !user) {
      setFiles([]);
      setCurrentPage(1);
      return;
    }

if (!currentDir) {
      setFiles([]);
      setCurrentPage(1);
      return;
    }

    // 优先从缓存加载，命中直接使用，跳过后台刷新避免重复扫描
    const cached = getCachedFiles(selectedRepo, currentDir);
    if (cached) {
      setFiles(cached);
      return;
    }
    setLoading(true);

    // 后台刷新
    scanMdFiles(selectedRepo, currentDir)
      .then(files => {
        sortByFrontMatterDate(files);
        setCachedFiles(selectedRepo, currentDir, files);
        setFiles(files);
      })
      .catch((err) => {
        console.error('加载文件列表失败:', err);
        setFiles([]);
      })
      .finally(() => setLoading(false));
  }, [selectedRepo, user, currentDir]);

  useEffect(() => {
    if (!selectedRepo) return;
    const key = getUndoKey(selectedRepo);
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const record: UndoRecord = JSON.parse(raw);
      const elapsed = Date.now() - record.deletedAt;
      if (elapsed > UNDO_TTL_MS) {
        sessionStorage.removeItem(key);
        return;
      }
      lastDeletedRef.current = { file: record.file, originalPath: record.originalPath };
      undoCleanupRef.current = setTimeout(() => {
        sessionStorage.removeItem(key);
        lastDeletedRef.current = null;
      }, UNDO_TTL_MS - elapsed);
    } catch {
    }
    return () => {
      if (undoCleanupRef.current) clearTimeout(undoCleanupRef.current);
    };
  }, [selectedRepo]);

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

  // 切换目录时，重置到第一页，避免残留页码导致空白分页
  useEffect(() => {
    setCurrentPage(1);
  }, [currentDir]);

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

  const handleDelete = async (file: EnhancedFileItem) => {
    if (!selectedRepo || !user) return;

    const trashPath = `${config.trashPath || '.trash'}/${file.name}`;

    try {
      await moveFile({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        fromPath: file.path,
        toPath: trashPath,
        sha: file.sha,
        branch: selectedRepo.branch,
        message: `[skip ci] 移至回收站: ${file.name}`,
        userName: user?.login
      });

      lastDeletedRef.current = { file, originalPath: file.path };
      if (selectedRepo) {
        try {
          const key = getUndoKey(selectedRepo);
          sessionStorage.setItem(key, JSON.stringify({
            file,
            originalPath: file.path,
            deletedAt: Date.now()
          }));
        } catch {
        }
      }

      setFiles(prev => prev.filter(f => f.path !== file.path));
      clearCache(selectedRepo);

      addToast({
        message: `已将 ${file.name} 移至回收站`,
        type: 'success',
        onUndo: async () => {
          try {
            await moveFile({
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              fromPath: trashPath,
              toPath: lastDeletedRef.current!.originalPath,
              branch: selectedRepo.branch,
              message: `恢复 ${file.name}`,
              userName: user?.login
            });
            setFiles(prev => [...prev, lastDeletedRef.current!.file]);
            clearCache(selectedRepo);
            addToast({ message: '已恢复', type: 'success' });
          } catch (err) {
            addToast({ message: `恢复失败: ${(err as Error).message}`, type: 'error' });
          }
          lastDeletedRef.current = null;
          if (selectedRepo) {
            try { sessionStorage.removeItem(getUndoKey(selectedRepo)); } catch { /* ignore */ }
          }
          if (undoCleanupRef.current) { clearTimeout(undoCleanupRef.current); undoCleanupRef.current = null; }
        }
      });
    } catch (err) {
      addToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    }
  };

  return (
    <div className="h-full flex flex-col">
      {selectedRepo && (
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
              placeholder="按文件名或提交信息筛选..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-card text-foreground placeholder-muted-foreground border border-border rounded-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>
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
          <div>
            {/* 桌面端表头 */}
            <div className="hidden md:flex items-center py-3 px-4 text-sm font-medium text-muted-foreground bg-accent border-b border-border">
              <div className="w-[40%]">文件名</div>
              <div className="w-[40%]">提交路径</div>
              <div className="w-[20%] text-right">操作</div>
            </div>

            {paginatedFiles.map((file: EnhancedFileItem) => (
              <div
                key={file.path}
                className="flex items-center px-4 py-3.5 cursor-pointer border-b border-border-subtle transition-colors hover:bg-accent"
                onClick={() => handleEdit(file)}
              >
                <div className="hidden md:flex items-center w-[40%] gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-success flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">
                    {file.name.replace('.md', '')}
                  </span>
                </div>
                <div className="hidden md:block w-[40%]">
                  <span className="text-sm text-muted-foreground">{file.path}</span>
                </div>
                <div className="hidden md:flex w-[20%] items-center justify-end gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(file);
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    编辑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(file);
                    }}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="移至回收站"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* 移动端：卡片布局 */}
                <div className="flex md:hidden flex-1 min-w-0 items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-success flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {file.name.replace('.md', '')}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {file.path}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(file);
                      }}
                      className="p-1.5 text-primary hover:bg-accent rounded transition-colors"
                      title="编辑"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(file);
                      }}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-accent rounded transition-colors"
                      title="移至回收站"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
