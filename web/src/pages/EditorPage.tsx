import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCollections } from '../contexts/CollectionsContext';
import { readFile, writeFile, commitBatch, formatTimestamp } from '../lib/api';
import { buildCommitMessage } from '../lib/deploySettings';
import { sanitizeSlug, filterValidDirs, fileStemFromPath } from '../lib/path';
import { resolvePathAndSlug } from '../lib/articleSlug';
import VditorEditor from '../components/editor/VditorEditor';
import SchemaFormPanel from '../components/editor/SchemaFormPanel';
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

export default function EditorPage() {
  const match = useMatch('/editor/*');
  const slug = match?.params['*'] || '';
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { config } = useCollections();
  const { addToast } = useToast();
  const { config: bufferConfig, refreshChanges, configLoading: bufferConfigLoading } = useBuffer();
  const bufferEnabled = bufferConfig?.enabled === true;
  const navigate = useNavigate();
  const vditorInstanceRef = useRef<Vditor | null>(null);
  const saveSeqRef = useRef(0);

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
      })
      .catch((err) => {
        console.error('加载文件失败:', err);
        setError(err.message || '加载失败');
      })
      .finally(() => setLoading(false));
  }, [isNew, slug, user, basePath, owner, repo, branch, hasLoadedOnce, bufferEnabled, bufferConfigLoading]);

  const handleVditorReady = useCallback((instance: Vditor) => {
    vditorInstanceRef.current = instance;
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
      addToast({ message: '核心词需为 a-z0-9，已忽略无效字符', type: 'warning' });
    }
    return next;
  };

  const syncUrlState = (url: string | undefined) => {
    if (url !== undefined) {
      setFrontmatter((prev) => ({ ...prev, url }));
    }
  };

  const handleSave = async () => {
    if (!user) return;
    // 缓冲配置未就绪时禁止落盘：否则会静默走 GitHub，造成「S3 无文件却进了 .draft」
    if (bufferConfigLoading) {
      addToast({ message: '缓冲配置加载中，请稍候再保存', type: 'warning' });
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

    let targetSlug: string;
    try {
      targetSlug = sanitizeSlug(resolved.fileStem);
    } catch (err) {
      addToast({ message: `URL 校验失败: ${(err as Error).message}`, type: 'warning' });
      return;
    }
    const editorContent = bodyContent || vditorInstanceRef.current?.getValue();
    const targetPath = isNew
      ? `${config.draftPath || '.draft'}/${targetSlug}.md`
      : currentFilePath || `${config.draftPath || '.draft'}/${targetSlug}.md`;

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
            addToast({ message: '已存入缓冲（文件名已更新）', type: 'success' });
            navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}${basePath ? `&basePath=${basePath}` : ''}`);
          }
        } else {
          await writeBufferFile({ owner, repo, branch, path: targetPath, op: 'write', content: fullContent, baseSha: currentFileSha || undefined });
          if (seq === saveSeqRef.current) {
            syncUrlState(effectiveFm.url);
            if (isNew) {
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
          addToast({ message: '保存成功（文件名已更新）', type: 'success' });
          navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}${basePath ? `&basePath=${basePath}` : ''}`);
        }
      } else {
        const isContentLibraryArticle = currentFilePath &&
          availableDirs.some((dir) => currentFilePath.startsWith(dir + '/'));
        const saveMessage = buildCommitMessage(
          `${targetSlug}.md-${timestamp}`,
          { skipCi: !isContentLibraryArticle }
        );

        await writeFile({
          owner, repo, path: targetPath, content: fullContent,
          message: saveMessage, branch,
          sha: currentFileSha || undefined, userName: user?.login
        });

        if (seq === saveSeqRef.current) {
          syncUrlState(effectiveFm.url);
          if (isNew) {
            const draftDir = config.draftPath || '.draft';
            setCurrentFilePath(`${draftDir}/${targetSlug}.md`);
            navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}&basePath=${encodeURIComponent(draftDir)}`);
          } else {
            const toastMsg = isContentLibraryArticle ? '保存成功（将触发重新部署）' : '草稿保存成功';
            addToast({ message: toastMsg, type: 'success' });
          }
        }
      }
    } catch (err) {
      console.error('Failed to save:', err);
      if (seq === saveSeqRef.current) {
        addToast({ message: `保存失败: ${(err as Error).message}`, type: 'error' });
      }
    } finally {
      setSaving(false);
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
        await writeBufferFile({ owner, repo, branch, path: trashFile, op: 'move', fromPath: currentFilePath });
        addToast({ message: '已存入缓冲（移至回收站）', type: 'success' });
        await refreshChanges();
        handleBack();
        return;
      }
      await commitBatch({
        owner, repo, branch,
        message: buildCommitMessage(`移至回收站: ${targetSlug}`, { skipCi: true }),
        ops: [{ op: 'move', fromPath: currentFilePath, path: trashFile }],
        userName: user?.login
      });
      addToast({ message: '已移至回收站', type: 'success' });
      handleBack();
    } catch (err) {
      addToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
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
          <p className="mt-3 text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button onClick={handleBack} className="mt-2 text-sm text-primary hover:underline">返回列表</button>
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
            {isNew ? '新建文章' : `编辑: ${frontmatter.title || slug}`}
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
              {saving ? '保存中...' : bufferConfigLoading ? '缓冲就绪中...' : bufferEnabled ? '保存到缓冲' : '保存'}
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
                  <div className="bg-white rounded-md shadow-sm p-4 w-full max-w-sm mx-4">
                    <p className="text-sm text-foreground mb-4">确定要将 "{frontmatter.title || frontmatter.url || slug}" 移至回收站吗？</p>
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
                        className="px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-sm transition-colors disabled:opacity-40"
                      >
                        {saving ? '处理中...' : '确认删除'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
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
            />
          </div>
        </div>

        <div className="hidden md:block w-72 bg-white border-l border-border overflow-auto flex-shrink-0">
          <SchemaFormPanel frontmatter={frontmatter} setFm={setFm} profile={profile} />
        </div>
      </div>

      {showMetadataPanel && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setShowMetadataPanel(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-[85vw] max-w-sm bg-white z-50 md:hidden overflow-auto">
            <div className="sticky top-0 bg-white border-b border-border px-4 py-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">文章配置</h3>
              <button onClick={() => setShowMetadataPanel(false)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="关闭面板">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SchemaFormPanel frontmatter={frontmatter} setFm={setFm} profile={profile} />
          </div>
        </>
      )}
    </div>
  );
}
