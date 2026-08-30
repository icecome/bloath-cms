import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCollections } from '../contexts/CollectionsContext';
import { readFile, writeFile, moveFile, formatTimestamp, renameFile } from '../lib/api';
import { sanitizeSlug, sanitizePath, filterValidDirs } from '../lib/path';
import VditorEditor from '../components/editor/VditorEditor';
import FrontmatterPanel from '../components/editor/FrontmatterPanel';
import { ArrowLeft, Save, Send, Trash2, Settings2, X, ChevronDown, ChevronUp } from 'lucide-react';
import Vditor from 'vditor';
import { parseFrontmatter, generateFrontmatter, type Frontmatter } from '../lib/frontmatter';
import { useToast } from '../contexts/ToastContext';

export default function EditorPage() {
  const match = useMatch('/editor/*');
  const slug = match?.params['*'] || '';
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { config } = useCollections();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const vditorInstanceRef = useRef<Vditor | null>(null);
  const saveSeqRef = useRef(0);

  const owner = searchParams.get('owner') || '';
  const repo = searchParams.get('repo') || '';
  const branch = searchParams.get('branch') || 'main';
  const paramBasePath = searchParams.get('basePath');
  const paramFilePath = searchParams.get('filePath');
  const returnTo = searchParams.get('returnTo') || '';

  const isNew = slug === 'new' && !slug.includes('.');
  const trashPath = config.trashPath || '.trash';

  const [publishTarget, setPublishTarget] = useState('');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const availableDirs = filterValidDirs(config.paths || []);

  const [frontmatter, setFrontmatter] = useState<Frontmatter>({});
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

  const basePath = useMemo(
    () => paramBasePath || (isNew ? (config.draftPath || '.draft') : (currentFilePath ? currentFilePath.split('/').slice(0, -1).join('/') : '')),
    [paramBasePath, isNew, config.draftPath, currentFilePath]
  );

  const defaultPublishTarget = currentFilePath
    ? currentFilePath.split('/').slice(0, -1).join('/')
    : '';

  const isDraftArticle = returnTo === 'drafts';

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

  useEffect(() => {
    if (isNew || !user || !basePath || hasLoadedOnce) return;
    const relativePath = paramFilePath || slug;
    if (!relativePath) return;

    setLoading(true);
    setError('');
    const filePath = `${basePath}/${relativePath}.md`;

    readFile({ owner, repo, path: filePath, branch })
      .then(({ content: fileContent, sha }) => {
        const { fm, body } = parseFrontmatter(fileContent);
        setFrontmatter(fm);
        setBodyContent(body);
        setCurrentFilePath(filePath);
        setCurrentFileSha(sha || '');
        setHasLoadedOnce(true);
        if (!fm.url && relativePath) {
          const urlFromPath = relativePath.replace(/\.md$/, '').split('/').pop() || '';
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
  }, [isNew, slug, user, basePath, owner, repo, branch, hasLoadedOnce]);

  const handleVditorReady = useCallback((instance: Vditor) => {
    vditorInstanceRef.current = instance;
  }, []);

  const getDraftPath = (targetSlug: string): string => {
    if (currentFilePath) return currentFilePath;
    return `${config.draftPath || '.draft'}/${targetSlug}.md`;
  };

  const setFm = (key: keyof Frontmatter, value: unknown) => {
    setFrontmatter((prev) => ({ ...prev, [key]: value }));
  };

  const getDefaultSlug = (): string => {
    const title = frontmatter.title || '未命名';
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${title.replace(/\s+/g, '-')}`;
  };

  const handleSave = async () => {
    if (!user) return;

    const effectiveFm = { ...frontmatter };
    if (isNew && !effectiveFm.url) {
      effectiveFm.url = getDefaultSlug();
      setFm('url', effectiveFm.url);
    }
    let targetSlug: string;
    try {
      targetSlug = sanitizeSlug(effectiveFm.url || slug);
    } catch (err) {
      addToast({ message: `URL 校验失败: ${(err as Error).message}`, type: 'warning' });
      return;
    }
    const editorContent = vditorInstanceRef.current?.getValue() || bodyContent;
    const targetPath = isNew
      ? `${config.draftPath || '.draft'}/${targetSlug}.md`
      : currentFilePath || `${config.draftPath || '.draft'}/${targetSlug}.md`;

    setSaving(true);
    const seq = ++saveSeqRef.current;
    try {
      const fullContent = `${generateFrontmatter(effectiveFm)}\n\n${editorContent}`;
      const timestamp = formatTimestamp();
      const saveBasePath = currentFilePath ? currentFilePath.split('/').slice(0, -1).join('/') : '';
      const newPath = saveBasePath ? `${saveBasePath}/${targetSlug}.md` : `${config.draftPath || '.draft'}/${targetSlug}.md`;
      const urlChanged = !isNew && !!currentFilePath && newPath !== currentFilePath;

      if (urlChanged) {
        const oldPath = currentFilePath;

        await renameFile({
          owner, repo, oldPath, newPath, content: fullContent,
          message: `[skip ci] ${targetSlug}.md-${timestamp}`,
          branch, sha: currentFileSha || undefined, userName: user?.login
        });

        if (seq === saveSeqRef.current) {
          setCurrentFilePath(newPath);
          setCurrentFileSha('');
          addToast({ message: '保存成功（文件名已更新）', type: 'success' });
          navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}${basePath ? `&basePath=${basePath}` : ''}`);
        }
      } else {
        const isContentLibraryArticle = currentFilePath &&
          availableDirs.some((dir) => currentFilePath.startsWith(dir + '/'));
        const saveMessage = isContentLibraryArticle
          ? `${targetSlug}.md-${timestamp}`
          : `[skip ci] ${targetSlug}.md-${timestamp}`;

        await writeFile({
          owner, repo, path: targetPath, content: fullContent,
          message: saveMessage, branch,
          sha: currentFileSha || undefined, userName: user?.login
        });

        if (seq === saveSeqRef.current) {
          if (isNew) {
            navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}`);
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

  const handlePublish = async () => {
    if (!user || !owner || !repo) return;

    const effectiveFm = { ...frontmatter };
    if (!effectiveFm.url) {
      effectiveFm.url = isNew ? getDefaultSlug() : slug;
      setFm('url', effectiveFm.url);
    }
    let targetSlug: string;
    try {
      targetSlug = sanitizeSlug(effectiveFm.url);
    } catch (err) {
      addToast({ message: `URL 校验失败: ${(err as Error).message}`, type: 'warning' });
      return;
    }
    const editorContent = vditorInstanceRef.current?.getValue() || bodyContent;

    let resolvedTarget: string;
    try {
      resolvedTarget = sanitizePath(publishTarget || defaultPublishTarget);
    } catch (err) {
      addToast({ message: `发布目标校验失败: ${(err as Error).message}`, type: 'warning' });
      return;
    }
    if (!resolvedTarget) {
      addToast({ message: '请选择发布目标目录', type: 'warning' });
      return;
    }

    setSaving(true);
    let publishedPath = '';
    try {
      const filePath = `${resolvedTarget}/${targetSlug}.md`;
      const fullContent = `${generateFrontmatter(effectiveFm)}\n\n${editorContent}`;
      const timestamp = formatTimestamp();

      const isContentLibraryAlreadyPublished = !isDraftArticle &&
        currentFilePath &&
        resolvedTarget === currentFilePath.split('/').slice(0, -1).join('/');

      if (!isContentLibraryAlreadyPublished) {
        await writeFile({
          owner, repo, path: filePath, content: fullContent,
          message: `${targetSlug}.md-${timestamp}`,
          branch, sha: currentFileSha || undefined, userName: user?.login
        });
        publishedPath = filePath;
      }

      if (isDraftArticle) {
        const draftPath = getDraftPath(targetSlug);
        if (currentFileSha) {
          await moveFile({
            owner, repo, fromPath: draftPath,
            toPath: `${trashPath}/${targetSlug}.md`,
            sha: currentFileSha, branch,
            message: `[skip ci] 移至回收站: ${targetSlug}`,
            userName: user?.login
          });
        } else {
          await writeFile({
            owner, repo, path: draftPath, content: '',
            message: `[skip ci] 删除草稿: ${targetSlug}`,
            userName: user?.login
          });
        }
      }

      addToast({ message: '发布成功', type: 'success' });
      setPublishTarget('');
      handleBack();
    } catch (err) {
      console.error('Failed to publish:', err);
      const errMsg = (err as Error).message;
      if (publishedPath && (errMsg.includes('draft') || errMsg.includes('trash'))) {
        addToast({ message: `文章已发布，但草稿清理失败: ${errMsg}。请手动删除草稿。`, type: 'error' });
        handleBack();
      } else {
        addToast({ message: `发布失败: ${errMsg}`, type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArticle = async () => {
    if (!user || !owner || !repo || !currentFilePath) return;

    const effectiveFm = { ...frontmatter };
    if (!effectiveFm.url) {
      effectiveFm.url = slug;
      setFm('url', effectiveFm.url);
    }
    const targetSlug = effectiveFm.url.replace('.md', '');
    const trashFile = `${trashPath}/${targetSlug}.md`;

    setSaving(true);
    try {
      await moveFile({
        owner, repo, fromPath: currentFilePath,
        toPath: trashFile, sha: currentFileSha, branch,
        message: `[skip ci] 移至回收站: ${targetSlug}`,
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

  const [newCategory, setNewCategory] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newPicture, setNewPicture] = useState('');
  const [newVideo, setNewVideo] = useState('');

  const addItem = (key: 'categories' | 'tags' | 'pictures' | 'video') => {
    const inputMap = { categories: newCategory, tags: newTag, pictures: newPicture, video: newVideo };
    const setterMap = { categories: setNewCategory, tags: setNewTag, pictures: setNewPicture, video: setNewVideo };
    const value = inputMap[key];
    if (!value?.trim()) return;
    const arr = frontmatter[key] || [];
    setFm(key, [...arr, value.trim()]);
    setterMap[key]('');
  };

  const removeArrayItem = (key: 'categories' | 'tags' | 'pictures' | 'video', index: number) => {
    const arr = frontmatter[key] || [];
    setFm(key, arr.filter((_, i) => i !== index));
  };

  const handleInputKeyDown = (key: 'categories' | 'tags' | 'pictures' | 'video', e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem(key);
    }
  };

  const frontmatterPanelProps = {
    frontmatter,
    setFm,
    removeArrayItem,
    newCategory,
    setNewCategory,
    newTag,
    setNewTag,
    newPicture,
    setNewPicture,
    newVideo,
    setNewVideo,
    addItem,
    handleInputKeyDown
  };

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
          {isNew || isDraftArticle ? (
            <button
              onClick={() => setShowPublishDialog(true)}
              disabled={saving}
              className="flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 text-sm bg-green-500 text-white rounded-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              <Send className="w-4 h-4" />
              <span className="hidden md:inline">{saving ? '发布中...' : '发布'}</span>
            </button>
          ) : null}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 text-sm bg-foreground text-background rounded-sm hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            <span className="hidden md:inline">{saving ? '保存中...' : '保存'}</span>
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
              {showPublishDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" onClick={() => setShowPublishDialog(false)}>
                  <div className="bg-white rounded-md shadow-sm p-4 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                    <h3 className="text-sm font-medium text-foreground mb-3">发布到目标目录</h3>
                    <div className="space-y-1.5 mb-3">
                      {availableDirs.map((dir) => (
                        <button
                          key={dir}
                          onClick={() => setPublishTarget(dir)}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-secondary transition-colors ${
                            publishTarget === dir ? 'text-foreground font-medium' : 'text-muted-foreground'
                          }`}
                        >
                          {publishTarget === dir && <span className="text-green-500">✓</span>}
                          <span className="truncate">{dir}</span>
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={publishTarget}
                      onChange={(e) => setPublishTarget(e.target.value)}
                      placeholder="或输入自定义路径"
                      className="w-full px-2.5 py-1.5 text-xs border border-border bg-white text-foreground placeholder:text-muted-foreground rounded-sm focus:outline-none focus:border-primary mb-3 transition-colors"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowPublishDialog(false)}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-secondary rounded-sm transition-colors disabled:opacity-40"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => { setShowPublishDialog(false); handlePublish(); }}
                        disabled={!publishTarget.trim() || saving}
                        className="px-3 py-1.5 text-sm text-white bg-green-500 hover:bg-green-600 rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {saving ? '发布中...' : '确认发布'}
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
          <FrontmatterPanel {...frontmatterPanelProps} />
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
            <FrontmatterPanel {...frontmatterPanelProps} />
          </div>
        </>
      )}
    </div>
  );
}
