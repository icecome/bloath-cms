import { useState, useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { readFile, writeFile, moveFile, formatTimestamp, renameFile } from '../lib/api';
import Toast from '../components/ui/Toast';
import VditorEditor from '../components/editor/VditorEditor';
import FrontmatterPanel from '../components/editor/FrontmatterPanel';
import { ArrowLeft, Save, Send, Trash2, Settings2, X, ChevronDown, ChevronUp } from 'lucide-react';
import Vditor from 'vditor';
import yaml from 'js-yaml';
import type { ArticleFrontmatter } from '../../../shared/types';

interface Frontmatter extends ArticleFrontmatter {}

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { fm: {}, body: raw.trim() };

  let fm: Frontmatter = {};
  try {
    fm = yaml.load(fmMatch[1]) as Frontmatter;
    for (const key of ['categories', 'tags', 'pictures', 'video'] as const) {
      if (fm[key] !== undefined && !Array.isArray(fm[key])) {
        (fm as Record<string, unknown>)[key] = [fm[key]];
      }
    }
  } catch {
    fm = {};
  }

  return { fm, body: raw.slice(fmMatch[0].length).trim() };
}

function generateFrontmatter(fm: Frontmatter): string {
  const cleanFm: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    // url 仅用于控制文件名，不写入 frontmatter
    if (key === 'url') continue;
    if (value !== undefined && value !== '' && value !== null) {
      cleanFm[key] = value;
    }
  }
  if (Object.keys(cleanFm).length === 0) return '---\n---';
  return '---\n' + yaml.dump(cleanFm, { lineWidth: -1 }) + '---';
}

export default function EditorPage() {
  const match = useMatch('/editor/*');
  const slug = match?.params['*'] || '';
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const navigate = useNavigate();
  const vditorInstanceRef = useRef<Vditor | null>(null);

  const owner = searchParams.get('owner') || '';
  const repo = searchParams.get('repo') || '';
  const branch = searchParams.get('branch') || 'main';
  const paramBasePath = searchParams.get('basePath');
  const paramFilePath = searchParams.get('filePath');
  const returnTo = searchParams.get('returnTo') || '';

  const isNew = slug === 'new' && !slug.includes('.');
  const trashPath = config.trashPath || '.trash';

  const [publishTarget, setPublishTarget] = useState('');
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const availableDirs = config.paths || [];

  const [frontmatter, setFrontmatter] = useState<Frontmatter>({});
  const [bodyContent, setBodyContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentFilePath, setCurrentFilePath] = useState('');
  const [currentFileSha, setCurrentFileSha] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; onUndo?: () => void } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);

  // 已有文章的 basePath 从 currentFilePath 推导，新建文章用 draftPath
  const basePath = paramBasePath || (isNew ? (config.draftPath || '.draft') : (currentFilePath ? currentFilePath.split('/').slice(0, -1).join('/') : ''));

  // 从当前文件路径提取默认发布目录（用于已有文章发布时自动填充）
  const defaultPublishTarget = currentFilePath
    ? currentFilePath.split('/').slice(0, -1).join('/')
    : '';

  // 判断当前文章是否在草稿箱中（否则视为内容库文章）
  const isDraftArticle = !!(currentFilePath && (config.draftPath || '.draft') && currentFilePath.startsWith(config.draftPath || '.draft'));

  // 返回处理：根据 returnTo 参数决定返回路径
  const handleBack = () => {
    if (returnTo === 'drafts') {
      navigate('/drafts');
    } else {
      // returnTo 是路径或为空，返回内容库首页
      navigate('/');
    }
  };

  // 加载已有文章：优先使用 filePath 参数（完整保留目录结构），slug 仅用于 URL 展示
  useEffect(() => {
    if (isNew || !user || !basePath) return;
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
        // 如果 Vditor 已就绪，更新内容
        if (vditorInstanceRef.current) {
          vditorInstanceRef.current.setValue(body);
        }
      })
      .catch((err) => {
        console.error('加载文件失败:', err);
        setError(err.message || '加载失败');
      })
      .finally(() => setLoading(false));
  }, [isNew, slug, user, basePath, owner, repo, branch]);

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

  // 生成默认 URL：日期-标题（精确到日）
  const getDefaultSlug = (): string => {
    const title = frontmatter.title || '未命名';
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}${m}${d}-${title.replace(/\s+/g, '-')}`;
  };

  const handleSave = async () => {
    if (!user) return;

    // 如果 URL 为空，自动生成默认值
    const effectiveFm = { ...frontmatter };
    if (isNew && !effectiveFm.url) {
      effectiveFm.url = getDefaultSlug();
      setFm('url', effectiveFm.url);
    }
    const targetSlug = effectiveFm.url || slug;
    const editorContent = vditorInstanceRef.current?.getValue() || bodyContent;
    const targetPath = isNew
      ? `${config.draftPath || '.draft'}/${targetSlug}.md`
      : currentFilePath || `${config.draftPath || '.draft'}/${targetSlug}.md`;

    setSaving(true);
    try {
      const fullContent = `${generateFrontmatter(effectiveFm)}\n\n${editorContent}`;
      const timestamp = formatTimestamp();

      // 检测 URL 变更：已有文章且 URL 与路由 slug 不同
      const urlChanged = !isNew && effectiveFm.url && effectiveFm.url !== slug && currentFilePath;

      if (urlChanged) {
        // URL 变更：写入新路径，删除旧文件
        const oldPath = currentFilePath;
        // 从当前文件路径推导目录（currentFilePath 在 useEffect 中已设置）
        const saveBasePath = currentFilePath.split('/').slice(0, -1).join('/');
        const newPath = `${saveBasePath}/${targetSlug}.md`;

        await renameFile({
          owner,
          repo,
          oldPath,
          newPath,
          content: fullContent,
          message: `[skip ci] ${targetSlug}.md-${timestamp}`,
          branch,
          sha: currentFileSha || undefined,
          userName: user?.login
        });

        setCurrentFilePath(newPath);
        setCurrentFileSha('');
        setToast({ message: '保存成功（文件名已更新）', type: 'success' });
        navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}${basePath ? `&basePath=${basePath}` : ''}`);
      } else {
        await writeFile({
          owner,
          repo,
          path: targetPath,
          content: fullContent,
          message: `[skip ci] ${targetSlug}.md-${timestamp}`,
          branch,
          sha: currentFileSha || undefined,
          userName: user?.login
        });

        if (isNew) {
          navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}`);
        } else {
          setToast({ message: '草稿保存成功', type: 'success' });
        }
      }
    } catch (err) {
      console.error('Failed to save:', err);
      setToast({ message: `保存失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!user || !selectedRepo) return;

    // 如果 URL 为空：新建文章自动生成默认值，已有文章 fallback 到路由 slug
    const effectiveFm = { ...frontmatter };
    if (!effectiveFm.url) {
      effectiveFm.url = isNew ? getDefaultSlug() : slug;
      setFm('url', effectiveFm.url);
    }
    const targetSlug = effectiveFm.url.replace('.md', '');
    const editorContent = vditorInstanceRef.current?.getValue() || bodyContent;

    // 优先使用当前文件所在目录作为发布目标
    const resolvedTarget = publishTarget || defaultPublishTarget;
    if (!resolvedTarget) {
      setToast({ message: '请选择发布目标目录', type: 'error' });
      return;
    }

    setSaving(true);
    let publishedPath = '';
    try {
      const filePath = `${resolvedTarget}/${targetSlug}.md`;
      const fullContent = `${generateFrontmatter(effectiveFm)}\n\n${editorContent}`;
      const timestamp = formatTimestamp();

      await writeFile({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        path: filePath,
        content: fullContent,
        message: `${targetSlug}.md-${timestamp}`,
        branch,
        sha: currentFileSha || undefined,
        userName: user?.login
      });
      publishedPath = filePath;

      // 仅对草稿箱文章执行草稿清理（内容库文章原地更新，无需清理）
      if (isDraftArticle) {
        const draftPath = getDraftPath(targetSlug);
        if (currentFileSha) {
          await moveFile({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            fromPath: draftPath,
            toPath: `${trashPath}/${targetSlug}.md`,
            sha: currentFileSha,
            branch,
            message: `[skip ci] 移至回收站: ${targetSlug}`,
            userName: user?.login
          });
        } else {
          await writeFile({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            path: draftPath,
            content: '',
            message: `[skip ci] 删除草稿: ${targetSlug}`,
            userName: user?.login
          });
        }
      }

      setToast({ message: '发布成功', type: 'success' });
      setPublishTarget('');
      handleBack();
    } catch (err) {
      console.error('Failed to publish:', err);
      // 如果发布成功但清理草稿失败，提示用户手动清理
      if (publishedPath && (err as Error).message.includes('draft') || (err as Error).message.includes('trash')) {
        setToast({ message: `文章已发布，但草稿清理失败: ${(err as Error).message}。请手动删除草稿。`, type: 'error' });
        handleBack();
      } else {
        setToast({ message: `发布失败: ${(err as Error).message}`, type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArticle = async () => {
    if (!user || !selectedRepo || !currentFilePath) return;

    // 删除操作针对已有文章，URL 为空时 fallback 到路由 slug
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
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        fromPath: currentFilePath,
        toPath: trashFile,
        sha: currentFileSha,
        branch,
        message: `[skip ci] 移至回收站: ${targetSlug}`,
        userName: user?.login
      });

      setToast({ message: '已移至回收站', type: 'success' });
      handleBack();
    } catch (err) {
      setToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  };

  // 键盘快捷键
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapperRef.current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (!activeEl || !wrapperRef.current?.contains(activeEl)) return;

      const vditorEditor = activeEl.closest('.vditor');
      const isFocusInEditor = !!vditorEditor;
      const isFocusInMetadataPanel = activeEl.matches('input, textarea, button, select') &&
        wrapperRef.current.contains(activeEl) &&
        !isFocusInEditor;

      if (isFocusInMetadataPanel) return;

      if (isFocusInEditor) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          e.stopPropagation();
          handleSaveRef.current();
          return;
        }

        const editKeys = ['c', 'v', 'x', 'z', 'y'];
        if ((e.ctrlKey || e.metaKey) && editKeys.includes(e.key.toLowerCase())) {
          return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          // Ctrl+A 放行，让浏览器默认全选行为生效
          return;
        }

        // 仅拦截已知快捷键，其余组合键放行
        const knownShortcuts = ['s', 'c', 'v', 'x', 'z', 'y'];
        if ((e.ctrlKey || e.metaKey || e.altKey) && knownShortcuts.includes(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    wrapperRef.current.addEventListener('keydown', handleKeyDown);
    return () => {
      wrapperRef.current?.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 数组字段操作
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
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* 顶部栏 */}
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
          {!isNew && (() => {
            if (isDraftArticle) {
              // 草稿箱文章：展示目录选择下拉框
              return (
                <div className="relative">
                  <button
                    onClick={() => setShowPublishDropdown(!showPublishDropdown)}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 text-sm bg-green-500 text-white rounded-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden md:inline">发布</span>
                  </button>
                  {showPublishDropdown && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-border z-50 min-w-[250px] p-2 shadow-sm" role="menu">
                      <p className="text-xs text-muted-foreground mb-2 px-1">发布到目标目录：</p>
                      <div className="space-y-0.5">
                        {availableDirs.map((dir) => (
                          <button
                            key={dir}
                            onClick={() => { setPublishTarget(dir); setShowPublishDropdown(false); }}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-secondary transition-colors ${
                              publishTarget === dir ? 'text-foreground font-medium' : 'text-muted-foreground'
                            }`}
                            role="menuitem"
                          >
                            {publishTarget === dir && <span className="text-green-500">✓</span>}
                            <span className="truncate">{dir}</span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-border">
                        <input
                          type="text"
                          value={publishTarget}
                          onChange={(e) => setPublishTarget(e.target.value)}
                          placeholder="或输入自定义路径"
                          className="w-full px-2.5 py-1.5 text-xs border border-border bg-white text-foreground placeholder:text-muted-foreground rounded-sm focus:outline-none focus:border-primary mb-2 transition-colors"
                        />
                        <button
                          onClick={() => { setShowPublishDropdown(false); handlePublish(); }}
                          disabled={!publishTarget.trim() || saving}
                          className="w-full px-2.5 py-1.5 text-xs text-white bg-green-500 rounded-sm hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {saving ? '发布中...' : '确认发布'}
                        </button>
                      </div>
                      <button
                        onClick={() => setShowPublishDropdown(false)}
                        className="w-full mt-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary rounded-sm transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              );
            } else {
              // 内容库文章：直接触发发布（原地更新）
              return (
                <button
                  onClick={() => handlePublish()}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 text-sm bg-green-500 text-white rounded-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden md:inline">{saving ? '发布中...' : '发布'}</span>
                </button>
              );
            }
          })()}
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
            </>
          )}
        </div>
      </header>

      <div ref={wrapperRef} className="flex-1 flex overflow-hidden">
        {/* 编辑器区域 */}
        <div className={`flex-1 flex flex-col overflow-hidden ${!showToolbar ? 'toolbar-hidden' : ''}`}>
          {/* 工具栏折叠按钮 */}
          <div className="flex items-center justify-end px-2 py-1 border-b border-[#F2F2F2] bg-[#FAFAFA]">
            <button
              onClick={() => setShowToolbar(!showToolbar)}
              className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#1F1F1F] transition-colors"
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

        {/* 桌面端右侧元数据面板 */}
        <div className="hidden md:block w-72 bg-white border-l border-border overflow-auto flex-shrink-0">
          <FrontmatterPanel
            frontmatter={frontmatter}
            setFm={setFm}
            removeArrayItem={removeArrayItem}
            newCategory={newCategory}
            setNewCategory={setNewCategory}
            newTag={newTag}
            setNewTag={setNewTag}
            newPicture={newPicture}
            setNewPicture={setNewPicture}
            newVideo={newVideo}
            setNewVideo={setNewVideo}
            addItem={addItem}
            handleInputKeyDown={handleInputKeyDown}
          />
        </div>
      </div>

      {/* 移动端元数据面板抽屉 */}
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
            <FrontmatterPanel
              frontmatter={frontmatter}
              setFm={setFm}
              removeArrayItem={removeArrayItem}
              newCategory={newCategory}
              setNewCategory={setNewCategory}
              newTag={newTag}
              setNewTag={setNewTag}
              newPicture={newPicture}
              setNewPicture={setNewPicture}
              newVideo={newVideo}
              setNewVideo={setNewVideo}
              addItem={addItem}
              handleInputKeyDown={handleInputKeyDown}
            />
          </div>
        </>
      )}
    </div>
  );
}
