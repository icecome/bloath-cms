import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { commitBatch, readFile } from '../lib/api';
import { buildCommitMessage } from '../lib/deploySettings';
import { scanMdFiles } from '../lib/scanner';
import { useFileListPage } from '../hooks/useFileListPage';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { clearCache } from '../lib/fileCache';
import { sanitizePath, filterValidDirs, dedupeTargetPaths } from '../lib/path';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import Pagination from '../components/ui/Pagination';
import FileTable from '../components/FileTable';

import { PAGE_SIZE } from '../lib/constants';
import {
  FileText,
  Search,
  Move,
  Trash2,
  Pencil,
  Target
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useBuffer } from '../contexts/BufferContext';
import { useDraftPreviews } from '../hooks/useDraftPreviews';
import { readBufferFile, writeBufferFile, discardBufferFile } from '../lib/bufferApi';
import { buildEditUrl } from '../lib/navigation';
import { mergeDraftList } from '../lib/draftMerge';
import { fetchDirTree, type DirNode } from '../lib/dirTree';
import { RenameDraftDialog } from '../components/drafts/RenameDraftDialog';
import { PublishDraftDialog } from '../components/drafts/PublishDraftDialog';
import { PreviewDraftDialog } from '../components/drafts/PreviewDraftDialog';

export default function DraftsPage() {
  const { user } = useAuth();
  const { selectedRepo } = useRepo();
  const { config: bufferConfig, changes: bufferChanges, refreshChanges, publish } = useBuffer();
  const bufferEnabled = bufferConfig?.enabled === true;
  const { config } = useCollections();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const draftPath = config.draftPath || '.draft';
  const trashPath = config.trashPath || '.trash';

  const {
    files,
    setFiles,
    loading,
    searchQuery,
    setSearchQuery,
    currentPage,
    setCurrentPage,
    selectedFiles,
    setSelectedFiles,
    handleSelectFile,
  } = useFileListPage({ basePath: draftPath, selectedRepo, user });

  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewTargets, setPreviewTargets] = useState<Record<string, string>>({});
  // 单篇预发布时记录目标路径，供对话框只处理这一条
  const [previewSinglePath, setPreviewSinglePath] = useState<string | null>(null);
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameFile, setRenameFile] = useState<EnhancedFileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  // 同步动作锁：actionLoading 是 state，同一事件循环内的第二次点击读到的仍是旧值，
  // 无法阻止双击重复提交（第二次 commitBatch 会因源文件已不存在而报错，
  // 用户看到"失败"但操作实际已生效）。ref 的读写是同步的，可堵住该窗口。
  const actionLockRef = useRef(false);
  const [dirNodes, setDirNodes] = useState<DirNode[]>([]);
  const lastDeletedRef = useRef<{ files: EnhancedFileItem[]; originalPaths: string[] } | null>(null);

  /** 获取动作锁；已被占用时返回 false，调用方应立即返回 */
  const acquireActionLock = useCallback((): boolean => {
    if (actionLockRef.current) return false;
    actionLockRef.current = true;
    return true;
  }, []);
  const releaseActionLock = useCallback((): void => {
    actionLockRef.current = false;
  }, []);

  const availableDirs = useMemo(() => filterValidDirs(config.paths || []), [config.paths]);

  // 预发布状态：存 localStorage，与缓冲层（S3）解耦，故有无 S3 都可用
  const { setPreviewBatch, cancelPreview, pruneOrphansFor, applyTo } = useDraftPreviews();

  // 仓库草稿 + 缓冲变更合并为统一列表，来源列区分；再叠加预发布状态
  const mergedFiles = useMemo(() => {
    const merged = bufferEnabled ? mergeDraftList(files, bufferChanges, draftPath) : files;
    return applyTo(merged);
  }, [files, bufferChanges, bufferEnabled, draftPath, applyTo]);

  // 预发布目标目录树：源自仓库真实树，以内容目录为根。
  // 仅预发布对话框需要选择目录（发布对话框已改为只读确认）。
  useEffect(() => {
    if (!selectedRepo || !showPreviewDialog) return;
    let cancelled = false;
    fetchDirTree(selectedRepo, availableDirs)
      .then((nodes) => { if (!cancelled) setDirNodes(nodes); })
      .catch(() => { if (!cancelled) setDirNodes([]); });
    return () => { cancelled = true; };
  }, [selectedRepo, showPreviewDialog, availableDirs]);

  const filteredFiles = useMemo(
    () => mergedFiles.filter((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [mergedFiles, searchQuery]
  );

  const totalPages = Math.ceil(filteredFiles.length / PAGE_SIZE);
  const paginatedFiles = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredFiles.slice(start, start + PAGE_SIZE);
  }, [filteredFiles, currentPage]);

  // 全选基于合并后的列表，与 useFileListPage 内部列表不同
  const handleSelectAllMerged = useCallback(() => {
    setSelectedFiles((prev) =>
      prev.size === filteredFiles.length
        ? new Set<string>()
        : new Set(filteredFiles.map((f) => f.path))
    );
  }, [filteredFiles, setSelectedFiles]);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, setCurrentPage]);

  const handleEdit = (file: EnhancedFileItem) => {
    if (!selectedRepo) return;
    const relative = file.path.replace(draftPath + '/', '');
    navigate(buildEditUrl({
      owner: selectedRepo.owner,
      repo: selectedRepo.repo,
      branch: selectedRepo.branch,
      basePath: draftPath,
      filePath: relative,
      returnTo: 'drafts',
    }));
  };

  const handleNew = () => {
    if (!selectedRepo) return;
    navigate(
      `/editor/new?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}`
    );
  };

  // ---------- 预发布 ----------

  /** 选中项中尚未预发布的草稿（已预发布的不重复处理） */
  const pendingPreviewItems = useMemo(
    () => mergedFiles.filter((f) => selectedFiles.has(f.path) && (f.previewState ?? 'draft') === 'draft'),
    [mergedFiles, selectedFiles]
  );

  /** 选中项中已预发布的草稿（含 stale 与 previewed） */
  const alreadyPreviewedCount = selectedFiles.size - pendingPreviewItems.length;

  /** 发布的前置校验：选中项必须全部完成预发布 */
  const publishBlocked = useMemo(() => {
    if (selectedFiles.size === 0) return false;
    const selected = mergedFiles.filter((f) => selectedFiles.has(f.path));
    return selected.some((f) => (f.previewState ?? 'draft') === 'draft');
  }, [mergedFiles, selectedFiles]);

  /** 打开预发布对话框（批量入口） */
  const openPreviewDialog = useCallback(() => {
    const pending = pendingPreviewItems;
    if (pending.length === 0) {
      addToast({ message: '选中的草稿均已完成预发布', type: 'info' });
      return;
    }
    // 沿用上一轮已填的目标，减少重复输入
    const initial: Record<string, string> = {};
    for (const f of pending) {
      initial[f.path] = previewTargets[f.path] ?? '';
    }
    setPreviewTargets(initial);
    setPreviewSinglePath(null);
    setShowPreviewDialog(true);
  }, [pendingPreviewItems, previewTargets, addToast]);

  /** 打开预发布对话框（表格行内单篇入口，含修改已预发布项的目标） */
  const openPreviewDialogFor = useCallback((file: EnhancedFileItem) => {
    // 不预先取消已有记录：写入是 upsert 语义，用户取消对话框时应保留原目标，
    // 预先删除会导致"打开后又取消"丢失原有预发布状态。
    setPreviewTargets({ [file.path]: file.previewTarget ?? '' });
    setPreviewSinglePath(file.path);
    setShowPreviewDialog(true);
  }, []);

  /** 取消预发布 */
  const handleCancelPreview = useCallback((file: EnhancedFileItem) => {
    cancelPreview(file.path);
    addToast({ message: `已取消「${file.name}」的预发布`, type: 'success' });
  }, [cancelPreview, addToast]);

  /** 预发布对话框的待处理项 */
  const previewDialogEntries = useMemo(() => {
    const source = previewSinglePath
      ? mergedFiles.filter((f) => f.path === previewSinglePath)
      : pendingPreviewItems;
    return source.map((f) => ({ path: f.path, name: f.name }));
  }, [previewSinglePath, mergedFiles, pendingPreviewItems]);

  /** 确认预发布：写入目标与当前 sha，供后续变更检测 */
  const handleConfirmPreview = useCallback(() => {
    const entries = previewDialogEntries
      .map((e) => {
        const item = mergedFiles.find((f) => f.path === e.path);
        const target = (previewTargets[e.path] || '').trim();
        return item && target ? { item, previewTarget: target } : null;
      })
      .filter((x): x is { item: EnhancedFileItem; previewTarget: string } => x !== null);

    if (entries.length === 0) {
      addToast({ message: '未指定目标目录，预发布未生效', type: 'warning' });
      return;
    }
    setPreviewBatch(entries);
    setShowPreviewDialog(false);
    setPreviewSinglePath(null);
    addToast({
      message: entries.length === 1
        ? `已标记预发布目标：${entries[0]!.previewTarget}`
        : `已预发布 ${entries.length} 篇`,
      type: 'success',
    });
  }, [previewDialogEntries, mergedFiles, previewTargets, setPreviewBatch, addToast]);

  // 统一发布：仓库草稿走 commit，缓冲项走逐项发布接口
  const handlePublish = async () => {
    if (!selectedRepo || !user || selectedFiles.size === 0) return;
    if (publishBlocked) {
      addToast({ message: '有草稿尚未预发布，请先预发布', type: 'warning' });
      return;
    }
    if (!acquireActionLock()) return;
    setActionLoading(true);
    try {
      const selectedItems = mergedFiles.filter((f) => selectedFiles.has(f.path));
      const repoItems = selectedItems.filter((f) => !f.source || f.source === 'repo');
      const bufferItems = selectedItems.filter((f) => f.source && f.source !== 'repo');

      let repoPublished = 0;
      let bufferPublished = 0;

      // 仓库草稿：按各自已预发布的目标 move 到目标目录
      const moveOps = repoItems
        .map((file) => {
          const raw = (file.previewTarget || '').trim();
          if (!raw) return null;
          let safeTarget: string;
          try { safeTarget = sanitizePath(raw); } catch (err) {
            throw new Error(`「${file.name}」目标路径无效: ${(err as Error).message}`);
          }
          return { op: 'move' as const, fromPath: file.path, path: `${safeTarget}/${file.name}` };
        })
        .filter((x): x is { op: 'move'; fromPath: string; path: string } => x !== null);

      if (moveOps.length > 0) {
        const targets = dedupeTargetPaths(moveOps.map((o) => o.path));
        await commitBatch({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          message: buildCommitMessage(`发布 ${moveOps.length} 篇草稿`),
          ops: moveOps.map((o, i) => ({ ...o, path: targets[i] ?? o.path })),
          userName: user.login,
        });
        repoPublished = moveOps.length;
      }

      // 缓冲项：一次提交，逐项目标由后端重写路径
      if (bufferEnabled && bufferItems.length > 0) {
        const result = await publish(user.login, bufferItems.map((f) => {
          const raw = (f.previewTarget || '').trim();
          return raw
            ? { path: f.path, publishTarget: sanitizePath(raw) }
            : { path: f.path };
        }));
        if (!result) throw new Error('缓冲发布失败');
        bufferPublished = result.published;
      }

      if (repoPublished === 0 && bufferPublished === 0) {
        addToast({ message: '未指定发布目标，文章仍留在草稿目录', type: 'info' });
      } else {
        addToast({ message: `已发布 ${repoPublished + bufferPublished} 篇`, type: 'success' });
      }

      setSelectedFiles(new Set());
      setShowPublishDropdown(false);
      clearCache(selectedRepo);
      await refreshChanges();
      const updatedFiles = await scanMdFiles(selectedRepo, draftPath);
      setFiles(updatedFiles);
      // 发布成功后清理预发布记录：按剩余草稿路径过滤，同时顺带清掉历史孤立项
      pruneOrphansFor(new Set(updatedFiles.map((f) => f.path)));
    } catch (err) {
      addToast({ message: `发布失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
      releaseActionLock();
    }
  };

  const handleMove = async () => {
    if (!selectedRepo || !user || selectedFiles.size === 0 || !moveTarget.trim()) return;
    let safeTarget: string;
    try {
      safeTarget = sanitizePath(moveTarget);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
      return;
    }
    // 锁在参数校验之后获取：校验失败路径直接返回，不会持有锁
    if (!acquireActionLock()) return;
    setActionLoading(true);
    try {
      // 仅仓库草稿可移动；缓冲项尚未落到仓库，需先发布
      const filesToMove = files.filter((f) => selectedFiles.has(f.path));
      const bufferedCount = selectedFiles.size - filesToMove.length;
      if (filesToMove.length === 0) {
        addToast({ message: '选中的都是缓存中的文章，请先发布后再移动', type: 'warning' });
        return;
      }
      const targets = dedupeTargetPaths(filesToMove.map((file) => `${safeTarget}/${file.name}`));
      await commitBatch({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
        message: buildCommitMessage(`移动 ${filesToMove.length} 篇草稿`, { skipCi: true }),
        ops: filesToMove.map((file, i) => ({
          op: 'move',
          fromPath: file.path,
          path: targets[i] ?? `${safeTarget}/${file.name}`
        })),
        userName: user?.login
      });
      addToast({
        message: bufferedCount > 0
          ? `已移动 ${filesToMove.length} 篇草稿，${bufferedCount} 篇缓存中的文章未处理`
          : `成功移动 ${filesToMove.length} 篇草稿`,
        type: 'success'
      });
      setSelectedFiles(new Set());
      setMoveTarget('');
      setShowMoveDropdown(false);
      clearCache(selectedRepo);
      const updatedFiles = await scanMdFiles(selectedRepo, draftPath);
      setFiles(updatedFiles);
    } catch (err) {
      addToast({ message: `移动失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
      releaseActionLock();
    }
  };

  const handleDelete = async () => {
    if (!selectedRepo || !user || selectedFiles.size === 0) return;
    if (!acquireActionLock()) return;

    const selectedItems = mergedFiles.filter((f) => selectedFiles.has(f.path));
    const repoItems = selectedItems.filter((f) => !f.source || f.source === 'repo');
    const bufferItems = selectedItems.filter((f) => f.source && f.source !== 'repo');

    setActionLoading(true);
    try {
      // 缓冲项：零 commit。仅在缓冲的直接丢弃记录；
      // 仓库有旧版的写 delete 墓碑，留待发布时一并删除
      for (const file of bufferItems) {
        if (file.source === 'buffer-modified') {
          await writeBufferFile({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            branch: selectedRepo.branch,
            path: file.path,
            op: 'delete',
          });
        } else {
          await discardBufferFile({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            branch: selectedRepo.branch,
            path: file.path,
          });
        }
      }

      if (repoItems.length > 0) {
        const targets = dedupeTargetPaths(repoItems.map((file) => `${trashPath}/${file.name}`));
        await commitBatch({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          message: buildCommitMessage(`移至回收站: ${repoItems.length} 篇草稿`, { skipCi: true }),
          ops: repoItems.map((file, i) => ({
            op: 'move',
            fromPath: file.path,
            path: targets[i] ?? `${trashPath}/${file.name}`
          })),
          userName: user?.login
        });
        lastDeletedRef.current = { files: repoItems, originalPaths: repoItems.map(f => f.path) };
        setFiles(prev => prev.filter(f => !selectedFiles.has(f.path)));
      }

      if (bufferItems.length > 0) await refreshChanges();
      clearCache(selectedRepo);

      const parts: string[] = [];
      if (repoItems.length > 0) parts.push(`${repoItems.length} 篇已移至回收站`);
      if (bufferItems.length > 0) parts.push(`${bufferItems.length} 篇缓存已删除`);
      addToast({ message: parts.join('，') || '未删除任何文件', type: 'success' });

      setSelectedFiles(new Set());
    } catch (err) {
      addToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
      releaseActionLock();
    }
  };

  const handleSingleDelete = async (file: EnhancedFileItem) => {
    if (!selectedRepo || !user) return;
    if (!acquireActionLock()) return;
    setActionLoading(true);

    const trashFile = `${trashPath}/${file.name}`;
    const isBuffered = !!file.source && file.source !== 'repo';

    try {
      // 缓冲项：零 commit，与批量删除保持一致
      if (bufferEnabled && isBuffered) {
        if (file.source === 'buffer-modified') {
          await writeBufferFile({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            branch: selectedRepo.branch,
            path: file.path,
            op: 'delete',
          });
        } else {
          await discardBufferFile({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            branch: selectedRepo.branch,
            path: file.path,
          });
        }
        await refreshChanges();
        addToast({ message: `已删除 ${file.name}（缓存，未提交到仓库）`, type: 'success' });
        return;
      }

      await commitBatch({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
        message: buildCommitMessage(`移至回收站: ${file.name}`, { skipCi: true }),
        ops: [{ op: 'move', fromPath: file.path, path: trashFile }],
        userName: user?.login
      });

      lastDeletedRef.current = { files: [file], originalPaths: [file.path] };

      setFiles(prev => prev.filter(f => f.path !== file.path));
      clearCache(selectedRepo);

      addToast({
        message: `已将 ${file.name} 移至回收站`,
        type: 'success',
        onUndo: async () => {
          try {
            if (!selectedRepo) return;
            const restoredFile = lastDeletedRef.current!.files[0];
            const originalPath = lastDeletedRef.current!.originalPaths[0];
            if (!restoredFile || !originalPath) return;
            await commitBatch({
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              branch: selectedRepo.branch,
              message: buildCommitMessage(`恢复 ${restoredFile.name}`, { skipCi: true }),
              ops: [{ op: 'move', fromPath: trashFile, path: originalPath }],
              userName: user?.login
            });
            setFiles(prev => [...prev, restoredFile]);
            addToast({ message: '已恢复', type: 'success' });
          } catch (err) {
            addToast({ message: `恢复失败: ${(err as Error).message}`, type: 'error' });
          }
          lastDeletedRef.current = null;
        }
      });
    } catch (err) {
      addToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
      releaseActionLock();
    }
  };

  const handleRename = async () => {
    if (!selectedRepo || !user || !renameFile || !renameValue.trim()) return;
    if (!acquireActionLock()) return;
    setActionLoading(true);
    try {
      const oldName = renameFile.name;
      const newName = `${renameValue.trim().replace(/\s+/g, '-')}.md`;
      const newDir = renameFile.path.substring(0, renameFile.path.lastIndexOf('/'));
      const newPath = `${newDir}/${newName}`;

      if (bufferEnabled) {
        // 缓冲模式下重命名不进仓库：读缓冲内容（miss 自动回退仓库），
        // 写新路径 + 删旧路径，均留在缓冲里
        const { content } = await readBufferFile({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          path: renameFile.path,
        });
        await writeBufferFile({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          path: newPath,
          op: 'write',
          content,
          publishTarget: renameFile.publishTarget,
        });
        await writeBufferFile({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          path: renameFile.path,
          op: 'delete',
          publishTarget: renameFile.publishTarget,
        });
        await refreshChanges();
      } else {
        const { content: fileContent } = await readFile({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          path: renameFile.path,
          branch: selectedRepo.branch
        });

        // 重命名 = 写新路径 + 删旧路径，合并为单 commit
        await commitBatch({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          message: buildCommitMessage(`重命名: ${oldName} -> ${newName}`, { skipCi: true }),
          ops: [
            { op: 'write', path: newPath, content: fileContent },
            { op: 'delete', path: renameFile.path }
          ],
          userName: user?.login
        });
      }

      addToast({ message: '重命名成功', type: 'success' });
      setShowRenameDialog(false);
      setRenameFile(null);
      setRenameValue('');
      clearCache(selectedRepo);
      const updatedFiles = await scanMdFiles(selectedRepo, draftPath);
      setFiles(updatedFiles);
    } catch (err) {
      addToast({ message: `重命名失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
      releaseActionLock();
    }
  };

  const openRenameDialog = (file: EnhancedFileItem) => {
    setRenameFile(file);
    const slug = file.name.replace('.md', '');
    setRenameValue(slug);
    setShowRenameDialog(true);
  };

  return (
    <div className="h-full flex flex-col">
      {selectedRepo && (
        <div className="flex-shrink-0 px-4 md:px-8 py-4 border-b border-border-subtle">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索草稿..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md pl-9 pr-3 py-2 text-sm bg-card text-foreground placeholder-muted-foreground border border-border rounded-sm focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {selectedFiles.size > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground bg-accent px-2.5 py-1.5 rounded-sm">
                已选 {selectedFiles.size} 篇
              </span>
              <button
                onClick={handleSelectAllMerged}
                className="text-sm text-muted-foreground hover:text-foreground hover:bg-accent px-2.5 py-1.5 rounded-sm transition-colors"
              >
                {selectedFiles.size === filteredFiles.length ? '取消全选' : '全选'}
              </button>

              <div className="w-px h-4 bg-border"></div>

              {/* 发布：需选中项全部完成预发布，否则禁用并提示 */}
              <button
                onClick={() => setShowPublishDropdown(true)}
                disabled={actionLoading || publishBlocked}
                title={publishBlocked ? '有草稿尚未预发布，请先预发布' : undefined}
                className="text-sm px-3 py-1.5 text-primary hover:bg-accent rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                发布
              </button>

              {/* 预发布：标记目标位置，不产生提交 */}
              <button
                onClick={openPreviewDialog}
                disabled={actionLoading}
                className="text-sm px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground rounded-sm transition-colors disabled:opacity-40"
              >
                预发布
              </button>

              {/* 移动 */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowMoveDropdown(!showMoveDropdown);
                    setShowPublishDropdown(false);
                  }}
                  disabled={actionLoading}
                  className="text-sm px-3 py-1.5 text-muted-foreground hover:bg-accent rounded-sm transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Move className="w-3.5 h-3.5" />
                  移动
                </button>
                {showMoveDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-card border border-border z-40 min-w-[220px] p-2">
                    <p className="text-sm text-muted-foreground mb-2 px-1">移动到：</p>
                    <input
                      type="text"
                      value={moveTarget}
                      onChange={(e) => setMoveTarget(e.target.value)}
                      placeholder="输入目标路径，如 content/.draft/sub"
                      className="w-full px-2.5 py-1.5 text-sm border border-border bg-card text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus:border-primary mb-2 transition-colors"
                    />
                    <button
                      onClick={handleMove}
                      disabled={!moveTarget.trim() || actionLoading}
                      className="w-full px-2.5 py-1.5 text-sm text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionLoading ? '移动中...' : `移动 ${selectedFiles.size} 篇`}
                    </button>
                    <button
                      onClick={() => setShowMoveDropdown(false)}
                      className="w-full mt-1 px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-sm transition-colors"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-border"></div>

              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="text-sm px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-destructive rounded-sm transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                删除
              </button>

              <div className="w-px h-4 bg-border"></div>

              <button
                onClick={() => {
                  const selected = mergedFiles.filter(f => selectedFiles.has(f.path));
                  if (selected.length === 1) {
                    const file = selected[0];
                    if (file) openRenameDialog(file);
                  }
                }}
                disabled={selectedFiles.size !== 1 || actionLoading}
                className="text-sm px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-primary rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                title="重命名"
              >
                <Pencil className="w-3.5 h-3.5" />
                重命名
              </button>
            </div>
          )}
        </div>
      )}

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
            onSelectAll={handleSelectAllMerged}
            onSelectFile={handleSelectFile}
            onRowClick={handleEdit}
            rowIcon={<FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
            nameColumnWidth="w-[26%]"
            pathColumnWidth="w-[26%]"
            showSource={bufferEnabled}
            showPreviewPath
            onPreviewPathClick={openPreviewDialog}
            draftPath={draftPath}
            renderDesktopActions={(file) => (
              <>
                <button
                  onClick={() => handleEdit(file)}
                  className="text-sm text-primary hover:underline cursor-pointer"
                >
                  编辑
                </button>
                {(file.previewState ?? 'draft') === 'draft' ? (
                  <button
                    onClick={() => openPreviewDialogFor(file)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    title="设置预发布目标"
                  >
                    预发布
                  </button>
                ) : (
                  <button
                    onClick={() => handleCancelPreview(file)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    title="取消预发布"
                  >
                    取消预发布
                  </button>
                )}
                <button
                  onClick={() => handleSingleDelete(file)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
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
                  className="p-1.5 text-primary hover:bg-accent rounded transition-colors"
                  title="编辑"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {(file.previewState ?? 'draft') === 'draft' ? (
                  <button
                    onClick={() => openPreviewDialogFor(file)}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                    title="设置预发布目标"
                  >
                    <Target className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleCancelPreview(file)}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                    title="取消预发布"
                  >
                    <Target className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleSingleDelete(file)}
                  className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-accent rounded transition-colors"
                  title="移至回收站"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          />
        ) : (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="暂无草稿"
            actionLabel="创建第一篇草稿"
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

      {showRenameDialog && renameFile && (
        <RenameDraftDialog
          value={renameValue}
          loading={actionLoading}
          onChange={setRenameValue}
          onConfirm={handleRename}
          onClose={() => setShowRenameDialog(false)}
        />
      )}

      {showPreviewDialog && (
        <PreviewDraftDialog
          entries={previewDialogEntries}
          skippedCount={previewSinglePath ? 0 : alreadyPreviewedCount}
          dirNodes={dirNodes}
          loading={actionLoading}
          targets={previewTargets}
          onTargetsChange={setPreviewTargets}
          onConfirm={handleConfirmPreview}
          onClose={() => { setShowPreviewDialog(false); setPreviewSinglePath(null); }}
        />
      )}

      {showPublishDropdown && (
        <PublishDraftDialog
          entries={filteredFiles
            .filter((f) => selectedFiles.has(f.path))
            .map((f) => ({
              path: f.path,
              name: f.name,
              previewTarget: f.previewTarget ?? '',
              stale: (f.previewState ?? 'draft') === 'preview-stale',
            }))}
          loading={actionLoading}
          onConfirm={handlePublish}
          onClose={() => setShowPublishDropdown(false)}
        />
      )}
    </div>
  );
}
