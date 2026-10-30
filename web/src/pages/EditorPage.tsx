import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCollections } from '../contexts/CollectionsContext';
import { useRepo } from '../contexts/RepoContext';
import { useMediaLibrary } from '../hooks/useMediaLibrary';
import { resolveMediaSource, mediaCdnUrl } from '../lib/resolveMediaSource';
import { useMediaUpload } from '../hooks/useMediaUpload';
import { MediaUploadDialog } from '../components/media/MediaUploadDialog';
import { readFile, writeFile, commitBatch, formatTimestamp } from '../lib/api';
import { buildCommitMessage } from '../lib/deploySettings';
import { sanitizeSlug, filterValidDirs, fileStemFromPath } from '../lib/path';
import { resolvePathAndSlug } from '../lib/articleSlug';
import VditorEditor from '../components/editor/VditorEditor';
import SchemaFormPanel, { validateFrontmatter } from '../components/editor/SchemaFormPanel';
import { HistoryPanel } from '../components/editor/HistoryPanel';
import MediaPickerDialog from '../components/editor/MediaPickerDialog';
import Modal from '../components/ui/Modal';
import { ArrowLeft, Save, Trash2, Settings2, X, ChevronDown, ChevronUp } from 'lucide-react';
import Vditor from 'vditor';
import {
  parseFrontmatter, generateFrontmatter, normalizeFmForProfile, generateOptionsFromProfile,
  type Frontmatter
} from '../lib/frontmatter';
import { getProfileForRepo } from '../lib/profileService';
import { getProfile, type SiteProfile } from '../../../shared/profiles';
import { useToast } from '../contexts/ToastContext';
import { useBuffer } from '../contexts/BufferContext';
import { writeBufferFile, readBufferFile } from '../lib/bufferApi';
import { checkConflictBeforeSave } from '../lib/conflict';
import {
  readEditorDraft,
  writeEditorDraft,
  clearEditorDraft,
  type EditorDraftCopy,
} from '../lib/editorDraftStore';

export default function EditorPage() {
  const match = useMatch('/editor/*');
  const slug = match?.params['*'] || '';
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { config, mediaConfig } = useCollections();
  const { selectedRepo } = useRepo();
  const { addToast } = useToast();
  const { config: bufferConfig, refreshChanges, configLoading: bufferConfigLoading } = useBuffer();
  const bufferEnabled = bufferConfig?.enabled === true;
  const navigate = useNavigate();
  const vditorInstanceRef = useRef<Vditor | null>(null);
  const saveSeqRef = useRef(0);
  /** 保存同步锁：堵双击窗口（P2-11） */
  const saveLockRef = useRef(false);

  const owner = searchParams.get('owner') || '';
  const repo = searchParams.get('repo') || '';
  const branch = searchParams.get('branch') || 'main';
  const paramBasePath = searchParams.get('basePath');
  const paramFilePath = searchParams.get('filePath');
  const returnTo = searchParams.get('returnTo') || '';

  const isNew = slug === 'new';
  const trashPath = config.trashPath || '.trash';

  const availableDirs = filterValidDirs(config.paths || []);

  const [frontmatter, setFrontmatter] = useState<Frontmatter>({});
  const [profile, setProfile] = useState<SiteProfile>(() => getProfile('custom'));
  const [bodyContent, setBodyContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentFilePath, setCurrentFilePath] = useState('');
  const [currentFileSha, setCurrentFileSha] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  /** 加载时的原始 slug；用于清空表单时不误删已有 front-matter slug */
  const initialSlugRef = useRef('');
  /** 本地草稿副本自动保存的节流定时器（P1-4 防丢稿） */
  const draftBackupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 待持久化的草稿状态（节流窗口内最新值），避免定时器回调读旧闭包 */
  const draftBackupStateRef = useRef<EditorDraftCopy | null>(null);
  /** 检测到本地有更新的未保存副本时提示恢复 */
  const [draftRecovery, setDraftRecovery] = useState<EditorDraftCopy | null>(null);

  const basePath = useMemo(
    () => paramBasePath || (isNew ? (config.draftPath || '.draft') : (currentFilePath ? currentFilePath.split('/').slice(0, -1).join('/') : '')),
    [paramBasePath, isNew, config.draftPath, currentFilePath]
  );

  const handleBack = () => {
    if (returnTo === 'drafts') {
      navigate('/drafts');
    } else if (returnTo) {
      // returnTo 是内容路径，返回内容库并停留在该目录
      navigate(`/?path=${encodeURIComponent(returnTo)}`);
    } else {
      navigate('/');
    }
  };

  // 加载仓库 Profile（有缓存时近乎同步，供表单渲染与 front-matter 生成使用）
  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    getProfileForRepo(owner, repo, branch)
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch(() => { /* 识别失败保持 custom 默认 */ });
    return () => { cancelled = true; };
  }, [owner, repo, branch]);

  useEffect(() => {
    if (isNew || !user || !basePath || hasLoadedOnce) return;
    // 缓冲配置未就绪时不读文件，避免先走 GitHub 后被 hasLoadedOnce 锁死
    if (bufferConfigLoading) return;
    const relativePath = paramFilePath || slug;
    if (!relativePath) return;

    setLoading(true);
    setError('');
    const filePath = `${basePath}/${relativePath}.md`;

    // 缓冲启用时优先读缓冲（miss 自动回退 GitHub）
    const loadFile = bufferEnabled
      ? readBufferFile({ owner, repo, branch, path: filePath }).then((r) => ({ content: r.content, sha: r.sha }))
      : readFile({ owner, repo, path: filePath, branch });

    loadFile
      .then(async ({ content: fileContent, sha }) => {
        const { fm, body } = parseFrontmatter(fileContent);
        const resolvedProfile = await getProfileForRepo(owner, repo, branch);
        const normalized = normalizeFmForProfile(fm, resolvedProfile);
        setProfile(resolvedProfile);
        setFrontmatter(normalized);
        setBodyContent(body);
        setCurrentFilePath(filePath);
        setCurrentFileSha(sha || '');
        setHasLoadedOnce(true);
        initialSlugRef.current = typeof normalized.url === 'string' ? normalized.url : '';
        // 解耦模式（Hugo）：URL 不从文件名回填，避免中文文件名写入 slug
        if (!normalized.url && relativePath && resolvedProfile.urlFilenameMode !== 'decoupled') {
          const urlFromPath = relativePath.replace(/\.md$/, '').split('/').pop() || '';
          initialSlugRef.current = urlFromPath;
          setFrontmatter((prev) => ({ ...prev, url: urlFromPath }));
        }
        if (vditorInstanceRef.current) {
          vditorInstanceRef.current.setValue(body);
        }

        // 本地防丢稿副本检查：存在未消费的本地副本时提示恢复（P1-4）。
        // 仓库侧 tree 的 lastModified 常缺省，无法做精确时间对比；
        // 副本只在「加载后编辑过」或「崩溃前未保存」两种情况下存在，
        // 而正常保存成功会清除副本，因此存在副本即值得让用户决策。
        const localCopy = readEditorDraft({ owner, repo, branch }, filePath);
        if (localCopy) {
          setDraftRecovery(localCopy);
        }
      })
      .catch((err) => {
        console.error('加载文件失败：', err);
        setError(err.message || '文章加载失败，请返回列表后重试');
      })
      .finally(() => setLoading(false));
  }, [isNew, slug, user, basePath, owner, repo, branch, hasLoadedOnce, bufferEnabled, bufferConfigLoading]);

  const handleVditorReady = useCallback((instance: Vditor) => {
    vditorInstanceRef.current = instance;
  }, []);

  /** 正文编辑器「插入图片」选择器开关 */
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  /** 选择器内「上传新图片」的上传弹窗开关 */
  const [mediaUploadOpen, setMediaUploadOpen] = useState(false);
  /** 媒体库刷新信号：上传完成后递增，让选择器重新拉取列表 */
  const [mediaReloadSignal, setMediaReloadSignal] = useState(0);

  /** 媒体库列表（与选择器共用同一 hook 实例的数据源，便于上传后统一刷新） */
  const mediaSource = useMemo(
    () => resolveMediaSource(mediaConfig, selectedRepo),
    [mediaConfig, selectedRepo]
  );
  const isS3MediaSource = mediaConfig.sourceType === 's3';
  /** S3 图床外链视图（仅 publicBaseUrl）；凭据已迁 Worker 侧 */
  const s3MediaConfig = mediaConfig.s3;

  /** 媒体库列表数据源：供上传管线的重名判定与上传后刷新使用 */
  const { reload: reloadMediaLibrary } = useMediaLibrary('image', true, mediaReloadSignal);

  /** 媒体库上传管线：编辑器内上传与媒体库页共用同一实现 */
  const {
    upload: runMediaUpload,
    uploading: mediaUploading,
    error: mediaUploadError,
    clearError: clearMediaUploadError,
  } = useMediaUpload({
    mediaConfig,
    source: mediaSource,
    login: user?.login ?? null,
    isS3Source: isS3MediaSource,
    s3View: s3MediaConfig,
    // 重名判定与上传后刷新复用媒体库 hook 的 reload
    loadFiles: reloadMediaLibrary,
    getCdnUrl: (path: string) => mediaCdnUrl(mediaSource, mediaConfig, path),
  });

  /** 媒体库选择回填：把选中的 URL 逐个写回 Vditor 正文（图片 Markdown 语法） */
  const handleMediaPick = useCallback((urls: string[]) => {
    const vditor = vditorInstanceRef.current;
    if (!vditor) return;
    // alt 用文件名（去扩展名）：固定「图片」信息量为零，对屏幕阅读器与 SEO 都无用
    const snippet = urls.map((url) => {
      const name = url.split('/').pop() || '';
      const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() || '图片';
      return `![${alt}](${url})`;
    }).join('\n');
    vditor.insertValue(snippet);
  }, []);

  const setFm = (key: keyof Frontmatter, value: unknown) => {
    setFrontmatter((prev) => ({ ...prev, [key]: value }));
  };

  const isDecoupled = profile.urlFilenameMode === 'decoupled';

  const getDefaultSlug = (): string => {
    const title = frontmatter.title || '未命名';
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${title.replace(/\s+/g, '-')}`;
  };

  const applyResolvedSlug = (fm: Frontmatter, result: ReturnType<typeof resolvePathAndSlug>): Frontmatter => {
    const next = { ...fm };
    if (result.frontmatterUrl) {
      next.url = result.frontmatterUrl;
      initialSlugRef.current = result.frontmatterUrl;
    } else if (isDecoupled && !isNew) {
      delete next.url;
    }
    if (result.coreDropped) {
      addToast({ message: '核心词仅限字母 a 至 z 与数字 0 至 9，已忽略无效字符', type: 'warning' });
    }
    return next;
  };

  const syncUrlState = (url: string | undefined) => {
    if (url !== undefined) {
      setFrontmatter((prev) => ({ ...prev, url }));
    }
  };

  // ---------- 草稿本地自动保存（P1-4 防丢稿） ----------
  const draftRepoKey = useMemo(() => ({ owner, repo, branch }), [owner, repo, branch]);

  /**
   * 新建文章的副本键：currentFilePath 为空时（新建且未首存）用合成路径
   * 参与防丢稿链路，否则 30s 节流 effect 与卸载落盘对新建文章永远不生效，
   * 会话过期跳转登录页会整体蒸发未保存内容（P0-006）。
   * 首存成功后按真实路径另行落盘/清除，合成键副本随 discardDraftBackup 清理。
   */
  const draftBackupPath = currentFilePath || (isNew ? `${config.draftPath || '.draft'}/.new-draft-local` : '');

  /** 节流写入本地副本：30s 窗口内的最后一次为准；组件卸载时立即落盘 */
  const scheduleDraftBackup = useCallback((copy: EditorDraftCopy) => {
    draftBackupStateRef.current = copy;
    if (draftBackupTimerRef.current) return;
    draftBackupTimerRef.current = setTimeout(() => {
      draftBackupTimerRef.current = null;
      if (draftBackupStateRef.current) {
        writeEditorDraft(draftRepoKey, draftBackupStateRef.current);
      }
    }, 30_000);
  }, [draftRepoKey]);

  // 内容变化 → 重置节流；front-matter 与正文任一变化都触发（写同一个 ref，幂等）。
  // 新建文章（draftBackupPath 为合成键）同样覆盖：路径为空不再是跳过理由。
  useEffect(() => {
    if (!hasLoadedOnce || !draftBackupPath) return;
    scheduleDraftBackup({
      path: draftBackupPath,
      frontmatter,
      body: bodyContent,
      savedAt: Date.now(),
    });
  }, [frontmatter, bodyContent, draftBackupPath, hasLoadedOnce, scheduleDraftBackup]);

  // 卸载或切换仓库时：立即落盘 + 清定时器
  useEffect(() => {
    return () => {
      if (draftBackupTimerRef.current) {
        clearTimeout(draftBackupTimerRef.current);
        draftBackupTimerRef.current = null;
      }
      if (draftBackupStateRef.current) {
        // 卸载时的 draftRepoKey 是最新的（闭包捕获当前渲染）
        writeEditorDraft(draftRepoKey, draftBackupStateRef.current);
        draftBackupStateRef.current = null;
      }
    };
  }, [draftRepoKey]);

  // auth:expired 全局事件：ProtectedRoute 会立即跳登录页并卸载编辑器，
  // 跳转前必须把内存中的最新草稿强制落盘（30s 节流窗口内的内容同样要保住）。
  // 新建文章走合成键（draftBackupPath），同样覆盖。事件在 user 清空后触发，
  // 本组件卸载 effect 也会跑一次——writeEditorDraft 幂等，双写无害。
  useEffect(() => {
    const flushOnAuthExpired = () => {
      if (draftBackupTimerRef.current) {
        clearTimeout(draftBackupTimerRef.current);
        draftBackupTimerRef.current = null;
      }
      if (draftBackupStateRef.current) {
        writeEditorDraft(draftRepoKey, draftBackupStateRef.current);
      }
    };
    window.addEventListener('auth:expired', flushOnAuthExpired);
    return () => window.removeEventListener('auth:expired', flushOnAuthExpired);
  }, [draftRepoKey]);

  /** 保存成功后清除本地副本（无未保存内容了） */
  const discardDraftBackup = useCallback((path: string | undefined) => {
    if (!path) return;
    if (draftBackupTimerRef.current) {
      clearTimeout(draftBackupTimerRef.current);
      draftBackupTimerRef.current = null;
    }
    draftBackupStateRef.current = null;
    clearEditorDraft(draftRepoKey, path);
  }, [draftRepoKey]);

  /** 恢复本地副本：覆盖当前编辑器状态 */
  const recoverDraftBackup = () => {
    const copy = draftRecovery;
    if (!copy) return;
    setFrontmatter(copy.frontmatter as Frontmatter);
    setBodyContent(copy.body);
    setDraftRecovery(null);
    addToast({ message: '已恢复未保存的本地草稿', type: 'success' });
  };

  /**
   * 保存前冲突检查（P1-3）：非缓冲模式下，若本地有基线 sha，
   * 复核远端同路径文件的 sha 是否仍与本地一致。远端已被他人/其他设备修改
   * 或删除时弹窗让用户决策，避免提交时才收到 409 硬失败。
   */
  const confirmNoRemoteConflict = async (targetPath: string): Promise<boolean> => {
    if (bufferEnabled || isNew || !currentFileSha) return true;

    const result = await checkConflictBeforeSave(readFile, {
      repo: { owner, repo, branch },
      path: targetPath,
      baseSha: currentFileSha,
    });

    if (!result.conflicted) return true;

    const kindMsg =
      result.kind === 'deleted'
        ? '该文章已被其他人删除。'
        : '该文章已在其他设备被修改。';
    // confirm 是最小可用实现：用户确认则覆盖远端，取消则中止保存
    // （后续可升级为「加载最新到本地合并」的三选项对话框）
    return window.confirm(
      `${kindMsg}直接保存将覆盖对方的内容。\n\n确定要覆盖保存吗？（取消可复制正文后另行处理）`
    );
  };

  const handleSave = async () => {
    if (!user) return;
    // 同步锁（P2-11）：冲突检查 await 期间 setSaving 尚未生效，双击 Ctrl+S
    // 会两路写入。ref 读写同步，堵住该窗口（同 DraftsPage actionLockRef 范式）。
    if (saveLockRef.current) return;
    saveLockRef.current = true;
    // 缓冲配置未就绪时禁止写入：否则会静默走 GitHub，造成「S3 无文件却进了 .draft」
    if (bufferConfigLoading) {
      addToast({ message: '缓冲配置加载中，请稍候再保存', type: 'warning' });
      saveLockRef.current = false;
      return;
    }

    const rawFm = { ...frontmatter };
    const resolved = resolvePathAndSlug({
      fm: rawFm,
      profile,
      isNew,
      currentFilePath,
      routeSlug: slug,
      initialSlug: initialSlugRef.current,
      defaultCoupledSlug: getDefaultSlug
    });
    const effectiveFm = applyResolvedSlug(rawFm, resolved);

    // 字段级校验（P2-4）：pattern / min / max，失败阻止保存并提示首个错误
    const validationError = validateFrontmatter(effectiveFm, profile);
    if (validationError) {
      addToast({ message: validationError, type: 'warning' });
      // 校验失败早退同样必须释放保存锁：锁已在此前获取，泄漏会让本页
      // 之后所有保存静默失效（仅 toast 提示、无任何请求发出）
      saveLockRef.current = false;
      return;
    }

    let targetSlug: string;
    try {
      targetSlug = sanitizeSlug(resolved.fileStem);
    } catch (err) {
      addToast({ message: `URL 校验失败：${(err as Error).message}`, type: 'warning' });
      saveLockRef.current = false;
      return;
    }
    const editorContent = bodyContent || vditorInstanceRef.current?.getValue();
    const targetPath = isNew
      ? `${config.draftPath || '.draft'}/${targetSlug}.md`
      : currentFilePath || `${config.draftPath || '.draft'}/${targetSlug}.md`;

    // 保存前冲突检查：远端已变/已删时由用户决策是否覆盖（缓冲模式走 S3 baseSha，无需此检查）
    const noConflict = await confirmNoRemoteConflict(targetPath);
    if (!noConflict) {
      saveLockRef.current = false;
      return;
    }

    setSaving(true);
    const seq = ++saveSeqRef.current;
    try {
      const fullContent = `${generateFrontmatter(effectiveFm, generateOptionsFromProfile(profile))}\n\n${editorContent}`;
      const timestamp = formatTimestamp();
      const saveBasePath = currentFilePath ? currentFilePath.split('/').slice(0, -1).join('/') : '';
      const newPath = saveBasePath ? `${saveBasePath}/${targetSlug}.md` : `${config.draftPath || '.draft'}/${targetSlug}.md`;
      const urlChanged = !isNew && !!currentFilePath && newPath !== currentFilePath;

      if (bufferEnabled) {
        // 缓冲模式：写 S3，零 commit
        if (urlChanged) {
          await writeBufferFile({ owner, repo, branch, path: newPath, op: 'write', content: fullContent, baseSha: currentFileSha || undefined });
          await writeBufferFile({ owner, repo, branch, path: currentFilePath, op: 'delete' });
          if (seq === saveSeqRef.current) {
            setCurrentFilePath(newPath);
            setCurrentFileSha('');
            syncUrlState(effectiveFm.url);
            discardDraftBackup(currentFilePath);
            discardDraftBackup(newPath);
            addToast({ message: '已存入缓冲，文件名已更新', type: 'success' });
            navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}${basePath ? `&basePath=${basePath}` : ''}`);
          }
        } else {
          await writeBufferFile({ owner, repo, branch, path: targetPath, op: 'write', content: fullContent, baseSha: currentFileSha || undefined });
          if (seq === saveSeqRef.current) {
            syncUrlState(effectiveFm.url);
            discardDraftBackup(targetPath);
            if (isNew) {
              // 首存前的合成键副本一并清除（P0-006）
              discardDraftBackup(`${config.draftPath || '.draft'}/.new-draft-local`);
              const draftDir = config.draftPath || '.draft';
              setCurrentFilePath(`${draftDir}/${targetSlug}.md`);
              navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}&basePath=${encodeURIComponent(draftDir)}`);
            }
            addToast({ message: '已存入缓冲', type: 'success' });
          }
        }
        await refreshChanges();
        return;
      }

      if (urlChanged) {
        const oldPath = currentFilePath;

        // 重命名 = 新路径写入 + 旧路径删除，合并为单 commit（原子，且只触发一次 CI）
        await commitBatch({
          owner, repo, branch,
          message: buildCommitMessage(`${targetSlug}.md-${timestamp}`, { skipCi: true }),
          ops: [
            { op: 'write', path: newPath, content: fullContent },
            { op: 'delete', path: oldPath }
          ],
          userName: user?.login
        });

        if (seq === saveSeqRef.current) {
          setCurrentFilePath(newPath);
          setCurrentFileSha('');
          syncUrlState(effectiveFm.url);
          // 保存成功 → 内容已持久化，清除本地防丢稿副本（旧路径与新路径都清）
          discardDraftBackup(oldPath);
          discardDraftBackup(newPath);
          addToast({ message: '保存成功，文件名已更新', type: 'success' });
          navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}${basePath ? `&basePath=${basePath}` : ''}`);
        }
      } else {
        const isContentLibraryArticle = currentFilePath &&
          availableDirs.some((dir) => currentFilePath.startsWith(dir + '/'));
        const saveMessage = buildCommitMessage(
          `${targetSlug}.md-${timestamp}`,
          { skipCi: !isContentLibraryArticle }
        );

        const writeResult = await writeFile({
          owner, repo, path: targetPath, content: fullContent,
          message: saveMessage, branch,
          sha: currentFileSha || undefined, userName: user?.login
        });

        if (seq === saveSeqRef.current) {
          syncUrlState(effectiveFm.url);
          // 用回传的新 blob sha 更新本地基线：否则下一次保存携带旧 sha 必然 409（P0-005）
          setCurrentFileSha(writeResult.sha || '');
          // 保存成功 → 清除本地防丢稿副本
          discardDraftBackup(targetPath);
          if (isNew) {
            // 首存前的合成键副本（.new-draft-local）一并清除，避免下次打开弹恢复框
            discardDraftBackup(`${config.draftPath || '.draft'}/.new-draft-local`);
            const draftDir = config.draftPath || '.draft';
            setCurrentFilePath(`${draftDir}/${targetSlug}.md`);
            navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}&basePath=${encodeURIComponent(draftDir)}`);
          } else {
            const toastMsg = isContentLibraryArticle ? '保存成功，将触发重新部署' : '草稿保存成功';
            addToast({ message: toastMsg, type: 'success' });
          }
        }
      }
    } catch (err) {
      console.error('Failed to save:', err);
      if (seq === saveSeqRef.current) {
        addToast({ message: `保存失败：${(err as Error).message}`, type: 'error' });
      }
    } finally {
      setSaving(false);
      saveLockRef.current = false;
    }
  };

  const handleDeleteArticle = async () => {
    if (!user || !owner || !repo || !currentFilePath) return;
    if (bufferConfigLoading) {
      addToast({ message: '缓冲配置加载中，请稍候再操作', type: 'warning' });
      return;
    }

    const targetSlug = fileStemFromPath(currentFilePath);
    const trashFile = `${trashPath}/${targetSlug}.md`;

    setSaving(true);
    try {
      if (bufferEnabled) {
        // currentFileSha 为空说明该文件只在缓冲、尚未进仓库：
        // 直接丢弃缓冲记录即可，无需产生任何 commit
        const onlyInBuffer = !currentFileSha;
        if (onlyInBuffer) {
          await writeBufferFile({ owner, repo, branch, path: currentFilePath, op: 'delete' });
          addToast({ message: '已删除，未提交到仓库', type: 'success' });
        } else {
          await writeBufferFile({ owner, repo, branch, path: trashFile, op: 'move', fromPath: currentFilePath });
          addToast({ message: '已存入缓冲，移至回收站', type: 'success' });
        }
        await refreshChanges();
        handleBack();
        return;
      }
      await commitBatch({
        owner, repo, branch,
        message: buildCommitMessage(`移至回收站：${targetSlug}`, { skipCi: true }),
        ops: [{ op: 'move', fromPath: currentFilePath, path: trashFile }],
        userName: user?.login
      });
      addToast({ message: '已移至回收站', type: 'success' });
      handleBack();
    } catch (err) {
      addToast({ message: `删除失败：${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapperRef.current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (!activeEl || !wrapperRef.current?.contains(activeEl)) return;

      const vditorEditor = activeEl.closest('.vditor');
      const isFocusInEditor = !!vditorEditor;
      const isFocusInMetadataPanel = activeEl.matches('input, textarea, button, select') &&
        wrapperRef.current.contains(activeEl) && !isFocusInEditor;

      if (isFocusInMetadataPanel) return;

      if (isFocusInEditor) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          e.stopPropagation();
          handleSaveRef.current();
          return;
        }

        const editKeys = ['c', 'v', 'x', 'z', 'y'];
        if ((e.ctrlKey || e.metaKey) && editKeys.includes(e.key.toLowerCase())) return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') return;

        const knownShortcuts = ['s', 'c', 'v', 'x', 'z', 'y'];
        if ((e.ctrlKey || e.metaKey || e.altKey) && knownShortcuts.includes(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    wrapperRef.current.addEventListener('keydown', handleKeyDown);
    return () => { wrapperRef.current?.removeEventListener('keydown', handleKeyDown); };
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto border-border"></div>
          <p className="mt-3 text-sm text-muted-foreground">加载中……</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button onClick={handleBack} className="mt-2 text-sm text-primary-text hover:underline">返回列表</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <header className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between flex-shrink-0 border-b border-border">
        <div className="flex items-center gap-2 md:gap-3">
          <button onClick={handleBack} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="返回">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-sm font-medium text-foreground truncate max-w-[120px] md:max-w-none">
            {isNew ? '新建文章' : `编辑：${frontmatter.title || slug}`}
          </h1>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            onClick={() => setShowMetadataPanel(!showMetadataPanel)}
            className="md:hidden flex items-center gap-1.5 px-2.5 py-2 text-sm text-muted-foreground border border-border rounded-sm hover:bg-secondary transition-colors"
            aria-label="切换元数据面板"
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            disabled={saving || bufferConfigLoading}
            className="flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 text-sm bg-foreground text-background rounded-sm hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            <span className="hidden md:inline">
              {saving ? '保存中……' : bufferConfigLoading ? '缓冲配置加载中……' : bufferEnabled ? '保存到缓冲' : '保存'}
            </span>
          </button>
          {!isNew && (
            <>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving}
                className="flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 text-sm text-muted-foreground hover:text-destructive border border-border hover:border-destructive rounded-sm transition-colors disabled:opacity-50"
                title="移至回收站"
                aria-label="移至回收站"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {showDeleteConfirm && (
                <Modal
                  ariaLabel="移至回收站确认"
                  onClose={() => setShowDeleteConfirm(false)}
                  className="bg-card rounded-md shadow-sm p-4 w-full max-w-sm mx-4"
                >
                  <p className="text-sm text-foreground mb-4">确定要将「{frontmatter.title || frontmatter.url || slug}」移至回收站吗？</p>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-secondary rounded-sm transition-colors disabled:opacity-40"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleDeleteArticle}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm text-white bg-destructive hover:bg-destructive/90 rounded-sm transition-colors disabled:opacity-40"
                      >
                        {saving ? '处理中……' : '确认删除'}
                      </button>
                    </div>
                </Modal>
              )}
            </>
          )}

          {/* 本地草稿恢复提示（P1-4）：检测到比仓库内容更新的未保存副本时弹出 */}
          {draftRecovery && (
            <Modal
              ariaLabel="恢复本地草稿"
              onClose={() => setDraftRecovery(null)}
              className="bg-card rounded-md shadow-sm p-4 w-full max-w-sm mx-4"
            >
              <p className="text-sm text-foreground mb-2">
                检测到本机有一份未保存的草稿副本（{new Date(draftRecovery.savedAt).toLocaleString()}）。
              </p>
              <p className="text-xs text-muted-foreground mb-4">恢复将覆盖当前编辑器内容；忽略则继续使用仓库内容，副本保留到下次成功保存。</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraftRecovery(null)}
                  className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-secondary rounded-sm transition-colors"
                >
                  忽略
                </button>
                <button
                  type="button"
                  onClick={recoverDraftBackup}
                  className="px-3 py-1.5 text-sm text-white bg-primary hover:bg-primary/90 rounded-sm transition-colors"
                >
                  恢复副本
                </button>
              </div>
            </Modal>
          )}
        </div>
      </header>

      <div ref={wrapperRef} className="flex-1 flex overflow-hidden">
        {/* 编辑器区域 */}
        <div className={`flex-1 flex flex-col overflow-hidden ${!showToolbar ? 'toolbar-hidden' : ''}`}>
          <div className="flex items-center justify-end px-2 py-1 border-b border-border bg-secondary">
            <button
              onClick={() => setShowToolbar(!showToolbar)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={showToolbar ? '折叠工具栏' : '展开工具栏'}
            >
              {showToolbar ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{showToolbar ? '折叠' : '展开'}</span>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <VditorEditor
              initialContent={bodyContent}
              onInput={setBodyContent}
              onReady={handleVditorReady}
              onPickImages={() => setMediaPickerOpen(true)}
            />
          </div>
        </div>

        <div className="hidden md:block w-72 bg-card border-l border-border overflow-auto flex-shrink-0">
          <SchemaFormPanel frontmatter={frontmatter} setFm={setFm} profile={profile} />
          {!isNew && currentFilePath && (
            <div className="border-t border-border">
              <HistoryPanel
                repo={{ owner, repo, branch }}
                filePath={currentFilePath}
                active
              />
            </div>
          )}
        </div>
      </div>

      {showMetadataPanel && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setShowMetadataPanel(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-[85vw] max-w-sm bg-card z-50 md:hidden overflow-auto">
            <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">文章配置</h3>
              <button onClick={() => setShowMetadataPanel(false)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="关闭面板">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SchemaFormPanel frontmatter={frontmatter} setFm={setFm} profile={profile} />
            {/* 移动端同样提供提交历史（桌面端在右侧栏） */}
            {!isNew && currentFilePath && (
              <div className="border-t border-border">
                <HistoryPanel
                  repo={{ owner, repo, branch }}
                  filePath={currentFilePath}
                  active
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* 正文「插入图片」：从媒体库选图后写回 Markdown */}
      <MediaPickerDialog
        open={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        multiple
        accept="image"
        onPick={handleMediaPick}
        onUploadNew={() => setMediaUploadOpen(true)}
        reloadSignal={mediaReloadSignal}
      />

      {/* 选择器内的「上传新图片」：上传完成后刷新选择器列表 */}
      <MediaUploadDialog
        open={mediaUploadOpen}
        onClose={() => setMediaUploadOpen(false)}
        defaultMode={mediaConfig.uploadMode}
        defaultQuality={mediaConfig.quality}
        defaultRenameTemplate={mediaConfig.renameTemplate}
        onUpload={async (files, options) => {
          const succeeded = await runMediaUpload(files, options);
          // 上传成功后让选择器重新拉取；上传失败时保留弹窗给用户看到错误
          if (succeeded.size > 0) setMediaReloadSignal((n) => n + 1);
          return succeeded;
        }}
        uploading={mediaUploading}
        error={mediaUploadError}
        onClearError={clearMediaUploadError}
      />
    </div>
  );
}
