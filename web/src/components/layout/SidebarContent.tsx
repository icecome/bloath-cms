// 侧栏内容（从 MainLayout 抽出）。
//
// 【为什么抽】2026-11-12 架构审查 P2：MainLayout.tsx 单文件 716 行含 2 个组件、
// 11 个 useState + 11 个 useEffect，承担导航、仓库/分支/账户三个下拉、主题、
// 全局搜索入口与发布按钮——90 天内改动 16 次（第 3 热点），每次都要读 700 行。
// 抽出后 SidebarContent 只负责「渲染 + 本地交互态」，仓库列表的加载/失败由
// MainLayout 通过 props 传入，职责边界变清晰。
//
// 【不抽的部分】主题切换、配置同步、仓库拉取仍留在 MainLayout：
// 它们依赖 Context 与网络副作用，属于布局壳的责任，下沉到展示组件会破坏
// 「展示组件不发起请求」的既有分层。
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCollections } from '../../contexts/CollectionsContext';
import { filterValidDirs } from '../../lib/path';
import type { DetectedRepo } from '../../lib/detectFramework';
import { PublishButton } from './PublishButton';
import {
  FilePlus2,
  Settings,
  LogOut,
  ChevronDown,
  Check,
  Users,
  Image as ImageIcon,
  Folder,
  Plus,
  Trash2,
  Search,
  Loader2,
} from 'lucide-react';

/** 仓库列表加载状态：null 表示加载中/未开始，非空字符串为失败原因 */
export type RepoListError = string | null;

export interface SidebarContentProps {
  repos: DetectedRepo[];
  /** 仓库列表加载中（与「仓库确实为 0」必须区分，否则空仓库永远显示「加载中」） */
  loadingRepos: boolean;
  /** 仓库列表加载失败原因（null = 无错误） */
  reposError: RepoListError;
  /** 重试拉取仓库列表 */
  onRetryRepos: () => void;
  selectedRepo: { owner: string; repo: string; branch: string } | null;
  branches: string[];
  /** 分支列表加载中（m-03：拉取失败不再伪造 ['main']，空列表与加载中需区分） */
  loadingBranches: boolean;
  user: { login: string; name?: string; avatar_url: string } | null;
  showRepoDropdown: boolean;
  showBranchDropdown: boolean;
  showAccountDropdown: boolean;
  setShowRepoDropdown: (v: boolean) => void;
  setShowBranchDropdown: (v: boolean) => void;
  setShowAccountDropdown: (v: boolean) => void;
  onRepoChange: (full_name: string) => void;
  onBranchChange: (branch: string) => void;
  onSwitchAccount: () => void;
  onLogout: () => void;
  onNewArticle: () => void;
  onNavClick: () => void;
  detectingFrameworks: boolean;
  /** 打开全局搜索（移动端侧栏入口，桌面端在顶栏） */
  onOpenSearch: () => void;
}

export function SidebarContent({
  repos, loadingRepos, reposError, onRetryRepos,
  selectedRepo, branches, loadingBranches, user,
  showRepoDropdown, showBranchDropdown, showAccountDropdown,
  setShowRepoDropdown, setShowBranchDropdown, setShowAccountDropdown,
  onRepoChange, onBranchChange, onSwitchAccount, onLogout, onNewArticle, onNavClick,
  detectingFrameworks, onOpenSearch
}: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { config } = useCollections();
  const [searchQuery, setSearchQuery] = useState('');

  // 有效内容路径（过滤 glob 模式），内容库次级导航由配置驱动
  const validPaths = useMemo(() => filterValidDirs(config.paths || []), [config.paths]);

  // activeDir 仅在内容库路由（/）生效，避免草稿箱/设置等页面误高亮
  const onContent = location.pathname === '/';
  const urlPath = searchParams.get('path');
  const activeDir = onContent
    ? (urlPath && validPaths.includes(urlPath) ? urlPath : (validPaths[0] || ''))
    : '';

  // 内容库主项展开状态（次级导航）
  const [contentOpen, setContentOpen] = useState(true);

  // URL 选中目录变化时确保内容库保持展开（如从编辑器返回）。
  // 只依赖 activeDir：把 contentOpen 放进依赖会让「用户手动折叠」立刻被这一句翻回去。
  useEffect(() => {
    if (activeDir) setContentOpen(true);
  }, [activeDir]);

  // URL 中的 path 指向已删除目录时清理，避免残留无效参数
  useEffect(() => {
    if (onContent && urlPath && !validPaths.includes(urlPath)) {
      navigate('/', { replace: true });
    }
  }, [onContent, urlPath, validPaths, navigate]);

  const selectDir = (dir: string) => {
    setContentOpen(true);
    navigate(`/?path=${encodeURIComponent(dir)}`);
    onNavClick();
  };

  // 下拉框关闭时重置搜索
  useEffect(() => {
    if (!showRepoDropdown) setSearchQuery('');
  }, [showRepoDropdown]);

  // 点击下拉外部时关闭（仓库/分支/账户三个下拉共用）
  useEffect(() => {
    if (!showRepoDropdown && !showBranchDropdown && !showAccountDropdown) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      // 下拉面板与触发按钮在 .dropdown-root 内部，不视为外部点击
      if (target.closest('.dropdown-root')) return;
      setShowRepoDropdown(false);
      setShowBranchDropdown(false);
      setShowAccountDropdown(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [showRepoDropdown, showBranchDropdown, showAccountDropdown, setShowRepoDropdown, setShowBranchDropdown, setShowAccountDropdown]);

  // Escape 优先关闭最后打开的下拉
  useEffect(() => {
    if (!showRepoDropdown && !showBranchDropdown && !showAccountDropdown) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showAccountDropdown) setShowAccountDropdown(false);
      else if (showBranchDropdown) setShowBranchDropdown(false);
      else setShowRepoDropdown(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showRepoDropdown, showBranchDropdown, showAccountDropdown, setShowRepoDropdown, setShowBranchDropdown, setShowAccountDropdown]);

  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return repos;
    const query = searchQuery.toLowerCase();
    return repos.filter((repo: DetectedRepo) =>
      repo.full_name.toLowerCase().includes(query) ||
      repo.name.toLowerCase().includes(query)
    );
  }, [repos, searchQuery]);

  const navItems = [
    { path: '/drafts', label: '草稿箱', icon: <FilePlus2 className="w-4 h-4" /> },
    { path: '/trash', label: '回收站', icon: <Trash2 className="w-4 h-4" /> },
    { path: '/media', label: '媒体库', icon: <ImageIcon className="w-4 h-4" /> },
    { path: '/settings', label: '设置', icon: <Settings className="w-4 h-4" /> },
  ];

  const isActive = (path: string) => location.pathname.startsWith(path);

  /**
   * 仓库下拉的空态文案。三态必须分开：
   * 加载中 / 加载失败（可重试）/ 确实没有匹配项。
   * 旧实现用 `repos.length === 0` 代替 loading 判定，仓库为 0 或拉取失败时
   * 会永远停在「加载中……」，用户无法判断是在等还是已经挂了。
   */
  const repoEmptyNotice = (() => {
    if (loadingRepos) return { text: '加载中……', retry: false };
    if (reposError) return { text: `仓库列表加载失败：${reposError}`, retry: true };
    if (repos.length === 0) return { text: '这个账号下没有可用仓库', retry: true };
    return { text: '没有匹配的仓库', retry: false };
  })();

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 flex items-center gap-2.5">
        <div className="w-6 h-6 flex items-center justify-center">
          <span className="text-lg font-bold text-foreground">B</span>
        </div>
        <span className="text-sm font-semibold text-foreground">Bloath CMS</span>
      </div>

      <div className="px-4 pb-3">
        <button
          onClick={() => { onNewArticle(); onNavClick(); }}
          disabled={!selectedRepo}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>新建文章</span>
        </button>
      </div>

      <PublishButton />

      {/* 全局搜索入口（侧栏唯一）：打开 GlobalSearchDialog，覆盖标题/标签/文件名跨目录匹配。
          桌面端靠 Ctrl/Cmd+K 快捷键；此处按钮保证移动端与不知道快捷键的用户可达。 */}
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => { onOpenSearch(); onNavClick(); }}
          disabled={!selectedRepo}
          className="w-full flex items-center gap-2 px-3 h-9 text-sm border border-border rounded-sm text-muted-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="打开全局搜索"
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-left truncate">搜索文章</span>
          <kbd className="text-[10px] opacity-60 flex-shrink-0">Ctrl K</kbd>
        </button>
      </div>

      <div className="px-4 pb-2">
        <div className="relative dropdown-root">
          <button
            onClick={() => { setShowRepoDropdown(!showRepoDropdown); setShowBranchDropdown(false); setShowAccountDropdown(false); }}
            aria-expanded={showRepoDropdown}
            aria-haspopup="listbox"
            aria-label="选择仓库"
            className="w-full h-9 px-3 text-sm border border-border rounded-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2 truncate"
          >
            <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            {detectingFrameworks ? (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />
            ) : (
              <span className="truncate">
                {selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : '选择仓库'}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${showRepoDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showRepoDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border z-50 max-h-64 overflow-auto">
              {/* 搜索框 */}
              <div className="sticky top-0 bg-card border-b border-border-subtle px-2 py-1.5">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索仓库……"
                    aria-label="搜索仓库"
                    className="w-full pl-7 pr-2 py-1 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring bg-card text-foreground placeholder:text-muted-foreground"
                    autoFocus
                  />
                </div>
              </div>
              {/* 仓库列表 */}
              <div>
                {filteredRepos.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    <span>{repoEmptyNotice.text}</span>
                    {repoEmptyNotice.retry && (
                      <button
                        type="button"
                        onClick={onRetryRepos}
                        className="ml-2 text-xs text-foreground underline hover:no-underline"
                      >
                        重试
                      </button>
                    )}
                  </div>
                ) : (
                  filteredRepos.map((repo) => (
                    <button
                      key={repo.full_name}
                      onClick={() => { onRepoChange(repo.full_name); setSearchQuery(''); onNavClick(); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors border-b border-border-subtle last:border-b-0 ${
                        selectedRepo?.owner === repo.owner && selectedRepo?.repo === repo.repo
                          ? 'text-foreground font-medium'
                          : 'text-foreground'
                      }`}
                    >
                      {selectedRepo?.owner === repo.owner && selectedRepo?.repo === repo.repo && (
                        <Check className="w-4 h-4 flex-shrink-0" />
                      )}
                      <span className="truncate flex-1">{repo.full_name}</span>
                      {repo.framework && (
                        <span
                          className="px-1.5 py-0.5 text-[10px] rounded-sm font-medium flex-shrink-0"
                          style={{ backgroundColor: repo.framework.color, color: '#fff' }}
                        >
                          {repo.framework.name}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 分支选择器 */}
      {selectedRepo && (
        <div className="px-4 pb-2">
          <div className="relative dropdown-root">
            <button
              onClick={() => { setShowBranchDropdown(!showBranchDropdown); setShowRepoDropdown(false); setShowAccountDropdown(false); }}
              disabled={loadingBranches}
              aria-expanded={showBranchDropdown}
              aria-haspopup="listbox"
              aria-label="选择分支"
              className="w-full h-8 px-3 text-sm border border-border-subtle bg-accent rounded-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 truncate disabled:opacity-50"
            >
              <span className="truncate">分支：{selectedRepo.branch}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showBranchDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border z-50 max-h-40 overflow-auto">
                {loadingBranches ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">加载中……</div>
                ) : branches.length === 0 ? (
                  // m-03：拉取失败不再伪造 ['main']，空列表明确显示「无可用分支」
                  <div className="px-3 py-2 text-sm text-muted-foreground">无可用分支（拉取失败或仓库无分支）</div>
                ) : (
                  branches.map((branch: string) => (
                    <button
                      key={branch}
                      onClick={() => { onBranchChange(branch); onNavClick(); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors ${
                        selectedRepo?.branch === branch
                          ? 'text-foreground font-medium'
                          : 'text-foreground'
                      }`}
                    >
                      {selectedRepo?.branch === branch && (
                        <Check className="w-4 h-4 flex-shrink-0" />
                      )}
                      <span className="truncate">{branch}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mx-4 border-t border-border-subtle"></div>

      {/* 导航菜单 */}
      <nav className="px-2 py-2 flex-1 overflow-y-auto">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">内容</div>

        {/* 内容库：主导航项，点击展开次级导航（各内容路径，样式贴合草稿箱等规范） */}
        <button
          onClick={() => {
            setContentOpen((v) => !v);
            if (!onContent) {
              navigate('/');
              onNavClick();
            }
          }}
          aria-expanded={contentOpen}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm transition-colors text-left ${
            onContent
              ? 'bg-accent text-foreground font-medium'
              : 'text-foreground hover:bg-muted'
          }`}
        >
          <Folder className="w-4 h-4 flex-shrink-0" />
          <span className="truncate flex-1">内容库</span>
        </button>

        {contentOpen && (
          <div className="mb-1">
            {validPaths.length > 0 ? (
              <div className="ml-3 pl-3 border-l border-border-subtle space-y-px">
                {validPaths.map((dir) => {
                  const isActiveDir = activeDir === dir;
                  return (
                    <button
                      key={dir}
                      onClick={() => selectDir(dir)}
                      className={`w-full flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-sm text-sm text-left transition-colors ${
                        isActiveDir
                          ? 'bg-accent text-foreground font-medium'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{dir}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                onClick={() => { navigate('/settings'); onNavClick(); }}
                className="mx-3 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                未配置内容路径，请前往设置添加
              </button>
            )}
          </div>
        )}

        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavClick}
            aria-current={isActive(item.path) ? 'page' : undefined}
            className={`flex items-center gap-2 px-3 py-2 rounded-sm text-sm transition-colors ${
              isActive(item.path)
                ? 'bg-accent text-foreground font-medium'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-border-subtle px-4 py-3">
        {user && (
          <div className="relative dropdown-root">
            <button
              onClick={() => setShowAccountDropdown(!showAccountDropdown)}
              aria-expanded={showAccountDropdown}
              aria-haspopup="menu"
              aria-label="账户菜单"
              className="w-full flex items-center gap-2 hover:bg-accent rounded-sm p-2 transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-sm overflow-hidden flex-shrink-0">
                <img src={user.avatar_url} alt={user.login} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{user.name || user.login}</p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform ${showAccountDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showAccountDropdown && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border z-50">
                <div className="px-3 py-2 border-b border-border-subtle">
                  <p className="text-sm font-medium text-foreground">{user.name || user.login}</p>
                  <p className="text-sm text-muted-foreground">@{user.login}</p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { onSwitchAccount(); onNavClick(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors text-foreground"
                  >
                    <Users className="w-4 h-4" />
                    切换账号
                  </button>
                  <button
                    onClick={() => { onLogout(); onNavClick(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors text-muted-foreground"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SidebarContent;
