import { useState, useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate, useSearchParams, useMatch } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRepo } from '../contexts/RepoContext';
import { useCollections } from '../contexts/CollectionsContext';
import { readFile, writeFile, moveFile } from '../lib/api';
import Toast from '../components/ui/Toast';
import { ArrowLeft, Save, Calendar, User, Tag, Folder, Image, Video, Lock, Link as LinkIcon, Send, Trash2 } from 'lucide-react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import yaml from 'js-yaml';

interface Frontmatter {
  title?: string;
  date?: string;
  author?: string;
  categories?: string[];
  tags?: string[];
  encrypt?: boolean;
  encryptPasswordKey?: string;
  encryptTitle?: string;
  encryptMessage?: string;
  pictures?: string[];
  video?: string[];
  link?: string;
  link_text?: string;
}

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { fm: {}, body: raw.trim() };

  let fm: Frontmatter = {};
  try {
    fm = yaml.load(fmMatch[1]) as Frontmatter;
    // 确保数组字段是数组
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
    if (value !== undefined && value !== '' && value !== null) {
      cleanFm[key] = value;
    }
  }
  if (Object.keys(cleanFm).length === 0) return '---\n---';
  return '---\n' + yaml.dump(cleanFm, { lineWidth: -1 }) + '---';
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:00+08:00`;
}

export default function EditorPage() {
  const match = useMatch('/editor/*');
  const slug = match?.params['*'] || '';
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const { selectedRepo } = useRepo();
  const { config } = useCollections();
  const navigate = useNavigate();
  const editorRef = useRef<HTMLDivElement>(null);
  const vditorInstanceRef = useRef<Vditor | null>(null);

  const owner = searchParams.get('owner') || '';
  const repo = searchParams.get('repo') || '';
  const branch = searchParams.get('branch') || 'main';
  const paramBasePath = searchParams.get('basePath');

  const isNew = slug === 'new';

  // 统一 basePath 来源：URL参数 > 新建默认草稿箱 > 空
  const basePath = paramBasePath || (isNew ? (config.draftPath || '.draft') : '');
  const trashPath = config.trashPath || '.trash';

  // 发布目标目录
  const [publishTarget, setPublishTarget] = useState('');
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);

  const availableDirs = config.paths || [];

  const [frontmatter, setFrontmatter] = useState<Frontmatter>({});
  const [bodyContent, setBodyContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // 当前编辑文件的完整路径和sha（用于删除操作）
  const [currentFilePath, setCurrentFilePath] = useState('');
  const [currentFileSha, setCurrentFileSha] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; onUndo?: () => void } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 初始化 Vditor 的函数
  const initializeVditor = useCallback(() => {
    if (!editorRef.current || vditorInstanceRef.current) return;

    const instance = new Vditor(editorRef.current, {
      height: '100%',
      mode: 'ir',
      placeholder: '开始编写 Markdown 内容...',
      cache: { enable: false },
      toolbarConfig: { pin: true },
      lang: 'zh_CN',
      after: () => {
        vditorInstanceRef.current = instance;
        if (bodyContent) {
          instance.setValue(bodyContent);
        }
      },
      input: (val: string) => {
        setBodyContent(val);
      }
    });
  }, [bodyContent]);

  // 组件卸载时清理 Vditor 实例
  useEffect(() => {
    return () => {
      try {
        vditorInstanceRef.current?.destroy();
      } catch (e) {
        // Ignore destroy errors
      }
      vditorInstanceRef.current = null;
    };
  }, []);

  // 加载已有文章
  useEffect(() => {
    if (isNew || !token || !slug) return;
    if (!basePath) return;

    setLoading(true);
    setError('');
    const filePath = `${basePath}/${slug}.md`;

    readFile(token, { owner, repo, path: filePath, branch })
      .then(({ content: fileContent, sha }) => {
        const { fm, body } = parseFrontmatter(fileContent);
        setFrontmatter(fm);
        setBodyContent(body);
        setCurrentFilePath(filePath);
        setCurrentFileSha(sha || '');
        // 文章加载完成后，确保 Vditor 已初始化
        if (!vditorInstanceRef.current && editorRef.current) {
          initializeVditor();
        }
      })
      .catch((err) => {
        console.error('加载文件失败:', err);
        setError(err.message || '加载失败');
      })
      .finally(() => setLoading(false));
  }, [isNew, slug, token, basePath, owner, repo, branch, initializeVditor]);

  // 新建文章时初始化 Vditor
  useEffect(() => {
    if (!isNew || !editorRef.current) return;
    if (!vditorInstanceRef.current) {
      initializeVditor();
    }
  }, [isNew, initializeVditor]);

  // 确定草稿文件路径
  const getDraftPath = (targetSlug: string): string => {
    if (currentFilePath) return currentFilePath;
    return `${config.draftPath || '.draft'}/${targetSlug}.md`;
  };

  const setFm = (key: keyof Frontmatter, value: unknown) => {
    setFrontmatter((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!token) return;

    const title = frontmatter.title || '未命名';
    const targetSlug = isNew ? title.replace(/\s+/g, '-') : slug;
    const editorContent = vditorInstanceRef.current?.getValue() || bodyContent;
    const targetPath = isNew ? `${config.draftPath || '.draft'}/${targetSlug}.md` : currentFilePath || `${config.draftPath || '.draft'}/${targetSlug}.md`;

    setSaving(true);
    try {
      const fullContent = `${generateFrontmatter(frontmatter)}\n\n${editorContent}`;

      await writeFile(token, {
        owner,
        repo,
        path: targetPath,
        content: fullContent,
        message: `[skip ci] 草稿: ${targetSlug}`,
        branch,
        sha: currentFileSha || undefined
      });

      if (isNew) {
        navigate(`/editor/${targetSlug}?owner=${owner}&repo=${repo}&branch=${branch}`, { replace: true });
      } else {
        setToast({ message: '草稿保存成功', type: 'success' });
      }
    } catch (err) {
      console.error('Failed to save:', err);
      setToast({ message: `保存失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!token || !selectedRepo) return;

    const targetSlug = slug.replace('.md', '');
    const editorContent = vditorInstanceRef.current?.getValue() || bodyContent;

    if (!publishTarget) {
      setToast({ message: '请选择发布目标目录', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const filePath = `${publishTarget}/${targetSlug}.md`;
      const fullContent = `${generateFrontmatter(frontmatter)}\n\n${editorContent}`;

      // 写入正式目录
      await writeFile(token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        path: filePath,
        content: fullContent,
        message: `发布: ${targetSlug}`,
        branch
      });

      // 真正删除草稿文件
      const draftPath = getDraftPath(targetSlug);
      if (currentFileSha) {
        await moveFile(token, {
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          fromPath: draftPath,
          toPath: `${trashPath}/${targetSlug}.md`,
          sha: currentFileSha,
          branch,
          message: `[skip ci] 移至回收站: ${targetSlug}`
        });
      } else {
        // 降级方案
        await writeFile(token, {
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          path: draftPath,
          content: '',
          message: `删除草稿: ${targetSlug}`
        });
      }

      setToast({ message: '发布成功', type: 'success' });
      navigate('/');
    } catch (err) {
      console.error('Failed to publish:', err);
      setToast({ message: `发布失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArticle = async () => {
    if (!token || !selectedRepo || !currentFilePath) return;

    const targetSlug = slug.replace('.md', '');
    const trashFile = `${trashPath}/${targetSlug}.md`;

    setSaving(true);
    try {
      await moveFile(token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        fromPath: currentFilePath,
        toPath: trashFile,
        sha: currentFileSha,
        branch,
        message: `[skip ci] 移至回收站: ${targetSlug}`
      });

      setToast({ message: '已移至回收站', type: 'success' });
      navigate('/');
    } catch (err) {
      setToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  };

  // 用 ref 保存 handleSave，避免键盘事件监听中的 stale state
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

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

  // === 键盘事件监听：基于 wrapperRef 的焦点隔离 ===
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapperRef.current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (!activeEl || !wrapperRef.current?.contains(activeEl)) return;

      // 判断焦点是否在 Vditor 编辑器内部
      const vditorEditor = activeEl.closest('.vditor');
      const isFocusInEditor = !!vditorEditor;

      // 判断焦点是否在元数据面板的输入框/文本域/按钮上
      const isFocusInMetadataPanel = activeEl.matches('input, textarea, button, select') &&
        wrapperRef.current.contains(activeEl) &&
        !isFocusInEditor;

      // 焦点在元数据面板：完全放行，让浏览器默认处理
      if (isFocusInMetadataPanel) return;

      // 焦点在 Vditor 编辑器内
      if (isFocusInEditor) {
        // 允许 Ctrl+S / Cmd+S 保存
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          e.stopPropagation();
          handleSaveRef.current();
          return;
        }

        // 允许编辑器的基础操作：复制、粘贴、剪切、撤销、重做
        const editKeys = ['c', 'v', 'x', 'z', 'y'];
        if ((e.ctrlKey || e.metaKey) && editKeys.includes(e.key.toLowerCase())) {
          return;
        }

        // Ctrl+A 执行编辑器内部全选
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          e.stopPropagation();
          // Vditor 没有 select 方法，直接 focus 让编辑器获得焦点即可
          vditorInstanceRef.current?.focus();
          return;
        }

        // 阻止其他 Ctrl / Cmd / Alt 组合键的全局行为
        if (e.ctrlKey || e.metaKey || e.altKey) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    wrapperRef.current.addEventListener('keydown', handleKeyDown);

    // 组件销毁时解绑
    return () => {
      wrapperRef.current?.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3B82F6] mx-auto border-[#E8E8E8]"></div>
          <p className="mt-3 text-sm text-[#6B7280]">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-[#EF4444]">{error}</p>
          <button onClick={() => navigate('/')} className="mt-2 text-sm text-[#3B82F6] hover:underline">返回列表</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* 顶部栏 */}
      <header className="px-6 py-4 flex items-center justify-between flex-shrink-0 border-b border-[#F2F2F2]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-[#6B7280] hover:text-[#1F1F1F] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-sm font-medium text-[#1F1F1F]">
            {isNew ? '新建文章' : `编辑: ${frontmatter.title || slug}`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* 发布按钮 */}
          {!isNew && (
            <div className="relative">
              <button
                onClick={() => {
                  setShowPublishDropdown(!showPublishDropdown);
                }}
                disabled={saving}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#22C55E] text-white rounded-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
                发布
              </button>
              {showPublishDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-[#E8E8E8] z-50 min-w-[250px] p-2">
                  <p className="text-xs text-[#6B7280] mb-2 px-1">发布到目标目录：</p>
                  <div className="space-y-0.5">
                    {availableDirs.map((dir) => (
                      <button
                        key={dir}
                        onClick={() => {
                          setPublishTarget(dir);
                          setShowPublishDropdown(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-[#F9FAFA] transition-colors ${
                          publishTarget === dir
                            ? 'text-[#1F1F1F] font-medium'
                            : 'text-[#374151]'
                        }`}
                      >
                        {publishTarget === dir && <span className="text-[#22C55E]">✓</span>}
                        <span className="truncate">{dir}</span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-[#F2F2F2]">
                    <input
                      type="text"
                      value={publishTarget}
                      onChange={(e) => setPublishTarget(e.target.value)}
                      placeholder="或输入自定义路径"
                      className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] bg-white text-[#1F1F1F] placeholder-[#9CA3AF] rounded-sm focus:outline-none focus:border-[#3B82F6] mb-2 transition-colors"
                    />
                    <button
                      onClick={() => {
                        setShowPublishDropdown(false);
                        handlePublish();
                      }}
                      disabled={!publishTarget.trim() || saving}
                      className="w-full px-2.5 py-1.5 text-xs text-white bg-[#22C55E] rounded-sm hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving ? '发布中...' : '确认发布'}
                    </button>
                  </div>
                  <button
                    onClick={() => setShowPublishDropdown(false)}
                    className="w-full mt-1 px-2.5 py-1.5 text-xs text-[#6B7280] hover:bg-[#F9FAFA] rounded-sm transition-colors"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? '保存中...' : '保存'}
          </button>
          {!isNew && (
            <>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm text-[#6B7280] hover:text-[#EF4444] border border-[#E8E8E8] hover:border-[#EF4444] rounded-sm transition-colors disabled:opacity-50"
                title="移至回收站"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {/* 删除确认弹窗 */}
              {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                  <div className="bg-white rounded-md shadow-sm p-4 w-full max-w-sm mx-4">
                    <p className="text-sm text-[#1F1F1F] mb-4">确定要将 "{frontmatter.title || slug}" 移至回收站吗？</p>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] rounded-sm transition-colors disabled:opacity-40"
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
        <div className="flex-1 overflow-hidden">
          <div ref={editorRef} className="h-full" />
        </div>

        {/* 右侧元数据面板 */}
        <div className="w-72 bg-white border-l border-[#F2F2F2] overflow-auto flex-shrink-0">
          <div className="p-4 space-y-4">
            <h3 className="text-xs font-medium text-[#1F1F1F] border-b border-[#F2F2F2] pb-2">文章配置</h3>

            {/* 标题 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <Folder className="w-3 h-3" />
                标题
              </label>
              <input
                type="text"
                value={frontmatter.title || ''}
                onChange={(e) => setFm('title', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                placeholder="文章标题"
              />
            </div>

            {/* 日期 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <Calendar className="w-3 h-3" />
                日期
              </label>
              <input
                type="datetime-local"
                value={frontmatter.date ? (() => {
                  try {
                    const d = new Date(frontmatter.date);
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    const h = String(d.getHours()).padStart(2, '0');
                    const mi = String(d.getMinutes()).padStart(2, '0');
                    return `${y}-${m}-${day}T${h}:${mi}`;
                  } catch {
                    return '';
                  }
                })() : ''}
                onChange={(e) => {
                  setFm('date', e.target.value ? `${e.target.value}:00+08:00` : '');
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F]"
              />
              <button
                type="button"
                onClick={() => setFm('date', formatDate(new Date()))}
                className="mt-1.5 text-xs text-[#3B82F6] hover:underline"
              >
                使用当前时间
              </button>
            </div>

            {/* 作者 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <User className="w-3 h-3" />
                作者
              </label>
              <input
                type="text"
                value={frontmatter.author || ''}
                onChange={(e) => setFm('author', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                placeholder="作者名称"
              />
            </div>

            {/* 分类 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <Folder className="w-3 h-3" />
                分类
              </label>
              <ArrayFieldList
                items={frontmatter.categories || []}
                onRemove={(i) => removeArrayItem('categories', i)}
              />
              <div className="flex gap-1.5 mt-1.5">
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => handleInputKeyDown('categories', e)}
                  className="flex-1 px-2 py-1 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                  placeholder="输入分类后回车"
                />
                <button onClick={() => addItem('categories')} className="px-2 py-1 text-xs bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors">添加</button>
              </div>
            </div>

            {/* 标签 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <Tag className="w-3 h-3" />
                标签
              </label>
              <ArrayFieldList
                items={frontmatter.tags || []}
                onRemove={(i) => removeArrayItem('tags', i)}
              />
              <div className="flex gap-1.5 mt-1.5">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => handleInputKeyDown('tags', e)}
                  className="flex-1 px-2 py-1 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                  placeholder="输入标签后回车"
                />
                <button onClick={() => addItem('tags')} className="px-2 py-1 text-xs bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors">添加</button>
              </div>
            </div>

            {/* 加密开关 */}
            <div className="flex items-center justify-between py-1">
              <span className="flex items-center gap-1.5 text-xs text-[#1F1F1F]">
                <Lock className="w-3 h-3 text-[#6B7280]" />
                加密
              </span>
              <ToggleSwitch
                checked={!!frontmatter.encrypt}
                onCheckedChange={() => setFm('encrypt', !frontmatter.encrypt)}
              />
            </div>

            {frontmatter.encrypt && (
              <div className="space-y-2 pl-3 border-l-2 border-[#F2F2F2]">
                <div>
                  <label className="block text-xs text-[#6B7280] mb-1.5">密码键名</label>
                  <input
                    type="text"
                    value={frontmatter.encryptPasswordKey || ''}
                    onChange={(e) => setFm('encryptPasswordKey', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                    placeholder="例如 private"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#6B7280] mb-1.5">加密标题</label>
                  <input
                    type="text"
                    value={frontmatter.encryptTitle || ''}
                    onChange={(e) => setFm('encryptTitle', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                    placeholder="需要密码访问"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#6B7280] mb-1.5">加密消息</label>
                  <textarea
                    value={frontmatter.encryptMessage || ''}
                    onChange={(e) => setFm('encryptMessage', e.target.value)}
                    rows={2}
                    className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors resize-none bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                    placeholder="请输入密码查看内容"
                  />
                </div>
              </div>
            )}

            <div className="border-t border-[#F2F2F2]" />

            {/* 图片 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <Image className="w-3 h-3" />
                图片
              </label>
              <ArrayFieldList
                items={frontmatter.pictures || []}
                onRemove={(i) => removeArrayItem('pictures', i)}
              />
              <div className="flex gap-1.5 mt-1.5">
                <input
                  type="text"
                  value={newPicture}
                  onChange={(e) => setNewPicture(e.target.value)}
                  onKeyDown={(e) => handleInputKeyDown('pictures', e)}
                  className="flex-1 px-2 py-1 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                  placeholder="图片 URL"
                />
                <button onClick={() => addItem('pictures')} className="px-2 py-1 text-xs bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors">添加</button>
              </div>
            </div>

            {/* 视频 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <Video className="w-3 h-3" />
                视频
              </label>
              <ArrayFieldList
                items={frontmatter.video || []}
                onRemove={(i) => removeArrayItem('video', i)}
              />
              <div className="flex gap-1.5 mt-1.5">
                <input
                  type="text"
                  value={newVideo}
                  onChange={(e) => setNewVideo(e.target.value)}
                  onKeyDown={(e) => handleInputKeyDown('video', e)}
                  className="flex-1 px-2 py-1 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                  placeholder="视频 URL"
                />
                <button onClick={() => addItem('video')} className="px-2 py-1 text-xs bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors">添加</button>
              </div>
            </div>

            {/* 链接 */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
                <LinkIcon className="w-3 h-3" />
                链接
              </label>
              <input
                type="text"
                value={frontmatter.link || ''}
                onChange={(e) => setFm('link', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF] mb-1.5"
                placeholder="链接 URL"
              />
              <input
                type="text"
                value={frontmatter.link_text || ''}
                onChange={(e) => setFm('link_text', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                placeholder="链接文本"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 数组字段列表组件
function ArrayFieldList({ items, onRemove }: { items: string[]; onRemove: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="flex-1 text-xs text-[#1F1F1F] bg-[#F9FAFA] px-2 py-1 rounded-sm border border-[#E8E8E8] truncate">{item}</span>
          <button onClick={() => onRemove(i)} className="text-xs text-[#6B7280] hover:text-[#1F1F1F]">×</button>
        </div>
      ))}
    </div>
  );
}

// 开关组件
function ToggleSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onCheckedChange}
      className={`w-9 h-5 rounded-full transition-colors relative ${
        checked ? 'bg-[#3B82F6]' : 'bg-[#E8E8E8]'
      }`}
    >
      <div
        className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
