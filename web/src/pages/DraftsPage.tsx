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
import { mapLimit } from '../lib/concurrency';
import { readUndoRecord, writeUndoRecord, clearUndoRecord } from '../lib/undoStore';
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
import { readBufferFile, writeBufferFile, discardBufferFile, setBufferPublishTarget } from '../lib/bufferApi';
import { buildEditUrl } from '../lib/navigation';
import { mergeDraftList } from '../lib/draftMerge';
import { fetchDirTree, type DirNode } from '../lib/dirTree';
import { RenameDraftDialog } from '../components/drafts/RenameDraftDialog';
import { PublishDraftDialog } from '../components/drafts/PublishDraftDialog';
import { PreviewDraftDialog } from '../components/drafts/PreviewDraftDialog';

/** 由草稿项与目标表构造待持久化条目；空目标项剔除（无目标的条目不进入发布/标记流程） */
function buildTargetEntries(
  items: ReadonlyArray<EnhancedFileItem>,
  targets: Record<string, string>
): Array<{ item: EnhancedFileItem; previewTarget: string }> {
  return items
    .map((item) => {
      const target = (targets[item.path] || '').trim();
      return target ? { item, previewTarget: target } : null;
    })
    .filter((x): x is { item: EnhancedFileItem; previewTarget: string } => x !== null);
}

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

  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewTargets, setPreviewTargets] = useState<Record<string, string>>({});
  // 发布对话框的逐项目标（P1-002：目标内联指定，替代先预发布再发布两步）
  const [publishTargets, setPublishTargets] = useState<Record<string, string>>({});
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
  // 用户看到「失败」但操作实际已生效）。ref 的读写是同步的，可堵住该窗口。
  const actionLockRef = useRef(false);
  const [dirNodes, setDirNodes] = useState<DirNode[]>([]);

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

  // 目录树获取：发布对话框与预发布对话框共用（发布对话框内联选择目标，P1-002）
  useEffect(() => {
    if (!selectedRepo || (!showPreviewDialog && !showPublishDialog)) return;
    let cancelled = false;
    fetchDirTree(selectedRepo, availableDirs)
      .then((nodes) => { if (!cancelled) setDirNodes(nodes); })
      .catch(() => { if (!cancelled) setDirNodes([]); });
    return () => { cancelled = true; };
  }, [selectedRepo, showPreviewDialog, showPublishDialog, availableDirs]);

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

  /** 发布对话框条目：全部选中项（目标在对话框内联指定，不再要求先预发布，P1-002） */
  const publishDialogEntries = useMemo(
    () =>
      mergedFiles
        .filter((f) => selectedFiles.has(f.path))
        .map((f) => ({
          path: f.path,
          name: f.name,
          currentPath: f.path,
          previewTarget: f.previewTarget ?? '',
          stale: (f.previewState ?? 'draft') === 'preview-stale',
        })),
    [mergedFiles, selectedFiles]
  );

  /** 打开发布对话框：按既有预发布目标预填，减少重复输入（P1-002） */
  const openPublishDialog = useCallback(() => {
    const initial: Record<string, string> = {};
    for (const f of mergedFiles) {
      if (selectedFiles.has(f.path)) initial[f.path] = f.previewTarget ?? '';
    }
    setPublishTargets(initial);
    setShowPublishDialog(true);
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
    // 预先删除会导致「打开后又取消」丢失原有预发布状态。
    setPreviewTargets({ [file.path]: file.previewTarget ?? '' });
    setPreviewSinglePath(file.path);
    setShowPreviewDialog(true);
  }, []);

  /** 是否缓冲项（预发布目标需同步进缓冲，供全量「发布变更」使用） */
  const isBufferItem = useCallback(
    (f: EnhancedFileItem) => !!f.source && f.source !== 'repo',
    []
  );

  /** 取消预发布 */
  const handleCancelPreview = useCallback(async (file: EnhancedFileItem) => {
    cancelPreview(file.path);
    if (selectedRepo && isBufferItem(file)) {
      try {
        await setBufferPublishTarget({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          path: file.path,
          publishTarget: null,
        });
        await refreshChanges();
      } catch (err) {
        addToast({ message: `取消预发布同步缓冲失败：${(err as Error).message}`, type: 'warning' });
      }
    }
    addToast({ message: `已取消「${file.name}」的预发布`, type: 'success' });
  }, [cancelPreview, addToast, selectedRepo, isBufferItem, refreshChanges]);

  /** 预发布对话框的待处理项 */
  const previewDialogEntries = useMemo(() => {
    const source = previewSinglePath
      ? mergedFiles.filter((f) => f.path === previewSinglePath)
      : pendingPreviewItems;
    return source.map((f) => ({ path: f.path, name: f.name }));
  }, [previewSinglePath, mergedFiles, pendingPreviewItems]);

  /**
   * 目标持久化（P1-002 抽取）：写入预发布记录并为缓冲项同步 S3 publishTarget。
   * 单键发布（先持久化再立即移动）与高级两步流（仅持久化）共用本步骤。
   * 返回实际持久化的条目数，供调用方判断是否为空操作。
   */
  const persistTargets = useCallback(async (
    entries: ReadonlyArray<{ item: EnhancedFileItem; previewTarget: string }>
  ): Promise<number> => {
    if (entries.length === 0) return 0;
    setPreviewBatch(entries);
    // 缓冲项同步 publishTarget，使侧边栏「发布变更」与菜单「发布」目标一致
    if (selectedRepo) {
      const bufferEntries = entries.filter((e) => isBufferItem(e.item));
      if (bufferEntries.length > 0) {
        const results = await Promise.allSettled(
          bufferEntries.map((e) => setBufferPublishTarget({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            branch: selectedRepo.branch,
            path: e.item.path,
            publishTarget: e.previewTarget,
          }))
        );
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          addToast({ message: `${failed.length} 篇预发布目标同步缓冲失败，发布变更可能仍落回草稿目录`, type: 'warning' });
        }
        await refreshChanges();
      }
    }
    return entries.length;
  }, [setPreviewBatch, addToast, selectedRepo, isBufferItem, refreshChanges]);


  /**
   * 确认预发布（高级流，批量/单篇共用）：写入目标与当前 sha，供后续变更检测。
   * 与单键发布的区别：仅固化目标，不产生提交。
   */
  const handleConfirmPreview = useCallback(async () => {
    const entries = buildTargetEntries(previewDialogEntries
      .map((e) => mergedFiles.find((f) => f.path === e.path))
      .filter((item): item is EnhancedFileItem => item !== undefined), previewTargets);

    if (entries.length === 0) {
      addToast({ message: '未指定目标目录，预发布未生效', type: 'warning' });
      setShowPreviewDialog(false);
      setPreviewSinglePath(null);
      return;
    }
    setActionLoading(true);
    try {
      await persistTargets(entries);
    } finally {
      setActionLoading(false);
      setShowPreviewDialog(false);
      setPreviewSinglePath(null);
    }
    addToast({
      message: entries.length === 1
        ? `已标记预发布目标：${entries[0]!.previewTarget}`
        : `已预发布 ${entries.length} 篇`,
      type: 'success',
    });
  }, [previewDialogEntries, mergedFiles, previewTargets, persistTargets, addToast]);


  /**
   * 单键发布确认（P1-002）：先持久化对话框内选定的目标（复用两步流的写入逻辑，
   * 保持缓冲同步语义），随后立即执行既有的移动/发布逻辑。整个合并操作由
   * actionLockRef 守卫，防止双击重复提交（同 handlePublish 的 P0-007 修复）。
   */
  const handleConfirmPublish = useCallback(async (targets: Record<string, string>) => {
    if (!selectedRepo || !user || selectedFiles.size === 0) return;
    if (!acquireActionLock()) return;
    setActionLoading(true);

    try {
      // 第一步：按对话框目标持久化预发布记录（与高级流完全同一段写入逻辑）
      const selectedItems = mergedFiles.filter((f) => selectedFiles.has(f.path));
      const targetEntries = buildTargetEntries(selectedItems, targets);
      if (targetEntries.length === 0) {
        addToast({ message: '未指定目标目录，未发布', type: 'warning' });
        return;
      }
      await persistTargets(targetEntries);

      // 第二步：立即发布。persistTargets 已写入本地记录 + 缓冲 publishTarget，
      // 但 mergedFiles 是渲染快照，previewTarget 需从 targets 表补齐后再走移动逻辑
      const itemsWithTargets = selectedItems.map((f) => ({
        ...f,
        previewTarget: targets[f.path]?.trim() || f.previewTarget,
      }));
      const repoItems = itemsWithTargets.filter((f) => !f.source || f.source === 'repo');
      const bufferItems = itemsWithTargets.filter((f) => f.source && f.source !== 'repo');
      let repoPublished = 0;
      let bufferFailed = false;
      let bufferPublished = 0;

      // 阶段一：仓库草稿按目标 move 到目标目录（与原 handlePublish 相同）
      const moveOps = repoItems
        .map((file) => {
          const raw = (file.previewTarget || '').trim();
          if (!raw) return null;
          let safeTarget: string;
          try { safeTarget = sanitizePath(raw); } catch (err) {
            throw new Error(`「${file.name}」目标路径无效：${(err as Error).message}`);
          }
          return { op: 'move' as const, fromPath: file.path, path: `${safeTarget}/${file.name}` };
        })
        .filter((x): x is { op: 'move'; fromPath: string; path: string } => x !== null);

      if (moveOps.length > 0) {
        const deduped = dedupeTargetPaths(moveOps.map((o) => o.path));
        await commitBatch({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          message: buildCommitMessage(`发布 ${moveOps.length} 篇草稿`),
          ops: moveOps.map((o, i) => ({ ...o, path: deduped[i] ?? o.path })),
          userName: user.login,
        });
        repoPublished = moveOps.length;
      }

      // 阶段二：缓冲项一次提交，逐项目标由后端重写路径。
      // 独立 try：阶段一成功后这里失败不应吞掉阶段一的成果。
      if (bufferEnabled && bufferItems.length > 0) {
        try {
          const result = await publish(user.login, bufferItems.map((f) => {
            const raw = (f.previewTarget || f.publishTarget || '').trim();
            return raw
              ? { path: f.path, publishTarget: sanitizePath(raw) }
              : { path: f.path };
          }));
          if (!result) throw new Error('缓冲发布失败');
          bufferPublished = result.published;
        } catch (err) {
          bufferFailed = true;
          console.error('[drafts] 缓冲发布失败（仓库部分可能已成功）：', err);
        }
      }

      const totalPublished = repoPublished + bufferPublished;
      if (totalPublished === 0 && !bufferFailed) {
        addToast({ message: '未指定发布目标，文章仍留在草稿目录', type: 'info' });
      } else if (bufferFailed) {
        addToast({
          message: `${repoPublished > 0 ? `已发布 ${repoPublished} 篇（仓库）；` : ''}缓冲发布失败，请稍后重试`,
          type: 'error',
        });
      } else {
        addToast({ message: `已发布 ${totalPublished} 篇`, type: 'success' });
      }

      setSelectedFiles(new Set());
      // 发布完成即关闭对话框（原 handlePublish 语义保留）
      setShowPublishDialog(false);
    } catch (err) {
      addToast({ message: `发布失败：${(err as Error).message}`, type: 'error' });
    } finally {
      // 无条件清态：列表与预发布记录以仓库实际状态为准（重扫纠偏，P0-007），
      // 已成功发布的条目即使本次整体失败也不会再进下一次 moveOps。
      clearCache(selectedRepo);
      await refreshChanges();
      try {
        const updatedFiles = await scanMdFiles(selectedRepo, draftPath);
        setFiles(updatedFiles);
        pruneOrphansFor(new Set(updatedFiles.map((f) => f.path)));
      } catch (err) {
        console.error('[drafts] 发布后重扫失败（列表可能短暂陈旧）：', err);
      }
      setActionLoading(false);
      releaseActionLock();
    }
  }, [selectedRepo, user, selectedFiles, mergedFiles, acquireActionLock, releaseActionLock, persistTargets, addToast, bufferEnabled, publish, setFiles, pruneOrphansFor, refreshChanges, draftPath]);

  /**
   * 高级流入口（P1-002）：从发布对话框进入，仅持久化目标不发布，
   * 保留原「先标记目标、稍后发布」的两步选项。成功提示与 handleConfirmPreview 一致。
   */
  const handleAdvancedMarkTargets = useCallback(async (targets: Record<string, string>) => {
    const selectedItems = mergedFiles.filter((f) => selectedFiles.has(f.path));
    const entries = buildTargetEntries(selectedItems, targets);
    if (entries.length === 0) {
      addToast({ message: '未指定目标目录，预发布未生效', type: 'warning' });
      return;
    }
    if (!acquireActionLock()) return;
    setActionLoading(true);
    try {
      await persistTargets(entries);
    } finally {
      setActionLoading(false);
      releaseActionLock();
      // 标记成功即回到列表，后续走工具栏「发布」或侧边栏「发布变更」
      setShowPublishDialog(false);
    }
    addToast({
      message: entries.length === 1
        ? `已标记预发布目标：${entries[0]!.previewTarget}`
        : `已预发布 ${entries.length} 篇`,
      type: 'success',
    });
  }, [mergedFiles, selectedFiles, acquireActionLock, releaseActionLock, persistTargets, addToast]);

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
        addToast({ message: '选中的都是缓冲中的文章，请先发布后再移动', type: 'warning' });
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
          ? `已移动 ${filesToMove.length} 篇草稿，${bufferedCount} 篇缓冲中的文章未处理`
          : `已移动 ${filesToMove.length} 篇草稿`,
        type: 'success'
      });
      setSelectedFiles(new Set());
      setMoveTarget('');
      setShowMoveDropdown(false);
      clearCache(selectedRepo);
      const updatedFiles = await scanMdFiles(selectedRepo, draftPath);
      setFiles(updatedFiles);
    } catch (err) {
      addToast({ message: `移动失败：${(err as Error).message}`, type: 'error' });
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
      // 仓库有旧版的写 delete 墓碑，留待发布时一并删除。
      // mapLimit 并发 4：替代 for-await 串行，批量删除耗时约降 3/4（P2-6）
      await mapLimit(bufferItems, 4, async (file) => {
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
      });

      if (repoItems.length > 0) {
        const targets = dedupeTargetPaths(repoItems.map((file) => `${trashPath}/${file.name}`));
        await commitBatch({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          message: buildCommitMessage(`移至回收站：${repoItems.length} 篇草稿`, { skipCi: true }),
          ops: repoItems.map((file, i) => ({
            op: 'move',
            fromPath: file.path,
            path: targets[i] ?? `${trashPath}/${file.name}`
          })),
          userName: user?.login
        });
        setFiles(prev => prev.filter(f => !selectedFiles.has(f.path)));
      }

      if (bufferItems.length > 0) await refreshChanges();
      clearCache(selectedRepo);

      const parts: string[] = [];
      if (repoItems.length > 0) parts.push(`${repoItems.length} 篇已移至回收站`);
      if (bufferItems.length > 0) parts.push(`${bufferItems.length} 篇缓冲已删除`);
      addToast({
        message: parts.join('，') || '未删除任何文件',
        type: 'success',
        // 撤销类 toast 不自动关闭（duration:0）：等用户决策；P1-003
        // 仓库草稿批量删除的撤销：sessionStorage 持久化（P3-4 undoStore），
        // TTL 10 分钟内（含刷新后）可撤销
        duration: 0,
        onUndo: repoItems.length > 0 ? async () => {
          try {
            if (!selectedRepo) return;
            const record = readUndoRecord<EnhancedFileItem>(selectedRepo, sessionStorage);
            if (!record || record.branch !== selectedRepo.branch) return;
            const targets = dedupeTargetPaths(record.originalPaths);
            await commitBatch({
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              branch: selectedRepo.branch,
              message: buildCommitMessage(`撤销删除：恢复 ${record.files.length} 篇草稿`, { skipCi: true }),
              ops: record.files.map((f, i) => ({
                op: 'move' as const,
                fromPath: `${trashPath}/${f.name}`,
                path: targets[i] ?? record.originalPaths[i] ?? `${trashPath}/${f.name}`
              })),
              userName: user?.login
            });
            setFiles((prev) => [...prev, ...record.files]);
            clearUndoRecord(selectedRepo, sessionStorage);
            clearCache(selectedRepo);
            addToast({ message: '已恢复全部草稿', type: 'success' });
          } catch (err) {
            addToast({ message: `恢复失败：${(err as Error).message}`, type: 'error' });
          }
        } : undefined
      });

      // 仓库草稿写入撤销记录（sessionStorage，TTL 10 分钟（P1-003），键含 branch）
      if (repoItems.length > 0 && selectedRepo) {
        writeUndoRecord<EnhancedFileItem>(
          selectedRepo,
          {
            files: repoItems,
            originalPaths: repoItems.map((f) => f.path),
            deletedAt: Date.now(),
            branch: selectedRepo.branch
          },
          sessionStorage
        );
      }

      setSelectedFiles(new Set());
    } catch (err) {
      addToast({ message: `删除失败：${(err as Error).message}`, type: 'error' });
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
        addToast({ message: `已删除 ${file.name}（缓冲，未提交到仓库）`, type: 'success' });
        return;
      }

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

      // 撤销记录与批量删除统一走 undoStore（sessionStorage，TTL 10 分钟，键含 branch）：
      // 旧实现单篇用 ref、批量用 store，刷新后单篇撤销静默丢失，语义不一致（P2 裁剪）。
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
            if (!record || record.branch !== selectedRepo.branch) return;
            const originalPath = record.originalPaths[0];
            const restoredFile = record.files[0];
            if (!originalPath || !restoredFile) return;
            await commitBatch({
              owner: selectedRepo.owner,
              repo: selectedRepo.repo,
              branch: selectedRepo.branch,
              message: buildCommitMessage(`恢复 ${restoredFile.name}`, { skipCi: true }),
              ops: [{ op: 'move', fromPath: trashFile, path: originalPath }],
              userName: user?.login
            });
            setFiles(prev => [...prev, restoredFile]);
            clearUndoRecord(selectedRepo, sessionStorage);
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
        const renamePublishTarget = renameFile.previewTarget ?? renameFile.publishTarget;
        await writeBufferFile({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          path: newPath,
          op: 'write',
          content,
          publishTarget: renamePublishTarget,
        });
        await writeBufferFile({
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          branch: selectedRepo.branch,
          path: renameFile.path,
          op: 'delete',
          publishTarget: renamePublishTarget,
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
          message: buildCommitMessage(`重命名：${oldName} → ${newName}`, { skipCi: true }),
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
      addToast({ message: `重命名失败：${(err as Error).message}`, type: 'error' });
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
        <>
        <div className="flex-shrink-0 px-4 md:px-8 py-4 flex items-center gap-3 border-b border-border-subtle">
          <h1 className="text-sm font-medium text-foreground whitespace-nowrap">草稿箱</h1>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="按文件名或路径筛选……"
              aria-label="按文件名或路径筛选草稿"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted text-foreground placeholder-muted-foreground border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            />
          </div>
        </div>

        {/* 批量操作工具栏：并入同一行容器，与筛选框同级（原为独立 mt-3 块） */}
        {selectedFiles.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
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

            {/* 发布（P1-002）：单键入口，目标在对话框内联指定；不再要求先预发布 */}
            <button
              onClick={openPublishDialog}
              disabled={actionLoading}
              className="text-sm px-3 py-1.5 text-primary-text hover:bg-accent rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              发布
            </button>

            {/* 预发布（高级）：仅标记目标，不产生提交；单键发布为主路径 */}
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
                  setShowPublishDialog(false);
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
                    className="w-full px-2.5 py-1.5 text-sm border border-border bg-muted text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring mb-2 transition-colors"
                  />
                  <button
                    onClick={handleMove}
                    disabled={!moveTarget.trim() || actionLoading}
                    className="w-full px-2.5 py-1.5 text-sm text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {actionLoading ? '移动中……' : `移动 ${selectedFiles.size} 篇`}
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
              className="text-sm px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-primary-text rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              title="重命名"
            >
              <Pencil className="w-3.5 h-3.5" />
              重命名
            </button>
          </div>
        )}
        </>
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
            nameColumnWidth="w-[24%]"
            pathColumnWidth="w-[24%]"
            showSource={bufferEnabled}
            showPreviewPath
            onPreviewPathClick={openPreviewDialog}
            draftPath={draftPath}
            renderDesktopActions={(file) => (
              <>
                <button
                  onClick={() => handleEdit(file)}
                  className="text-sm text-primary-text hover:underline cursor-pointer whitespace-nowrap"
                >
                  编辑
                </button>
                {(file.previewState ?? 'draft') === 'draft' ? (
                  <button
                    onClick={() => openPreviewDialogFor(file)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                    title="设置发布目标目录"
                  >
                    设目标
                  </button>
                ) : (
                  <button
                    onClick={() => handleCancelPreview(file)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                    title="取消预发布"
                  >
                    取消预发布
                  </button>
                )}
                <button
                  onClick={() => handleSingleDelete(file)}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
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
                {(file.previewState ?? 'draft') === 'draft' ? (
                  <button
                    onClick={() => openPreviewDialogFor(file)}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                    title="设置发布目标目录"
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

      {showPublishDialog && (
        <PublishDraftDialog
          entries={publishDialogEntries}
          dirNodes={dirNodes}
          loading={actionLoading}
          targets={publishTargets}
          onTargetsChange={setPublishTargets}
          onConfirm={handleConfirmPublish}
          onAdvanced={handleAdvancedMarkTargets}
          onClose={() => setShowPublishDialog(false)}
        />
      )}
    </div>
  );
}