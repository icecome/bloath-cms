import { Outlet, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRepo } from '../../contexts/RepoContext';
import { useCollections } from '../../contexts/CollectionsContext';
import { getRepos } from '../../lib/api';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { detectFrameworks, type DetectedRepo } from '../../lib/detectFramework';
import { scanMdFiles } from '../../lib/scanner';
import { sortByFrontMatterDate } from '../../lib/sortFiles';
import { getCachedFiles, setCachedFiles } from '../../lib/fileCache';
import type { SelectedRepo } from '../../../../shared/types';
import { filterValidDirs } from '../../lib/path';
import { buildEditUrl } from '../../lib/navigation';
import type { EnhancedFileItem } from '../../lib/extractFrontMatter';
import {
  FilePlus2,
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Check,
  Users,
  Image as ImageIcon,
  Folder,
  Plus,
  Trash2,
  Menu,
  X,
  Search,
  Loader2,
  FileText
} from 'lucide-react';

// 导航配置（模块级常量，SidebarContent 和 Header 面包屑共用）
const NAV_ITEM_LABELS: Record<string, string> = {
  '/': '内容库',
  '/drafts': '草稿箱',
  '/trash': '回收站',
  '/media': '媒体库',
  '/settings': '设置',
};

function getCurrentNavLabel(pathname: string): string {
  const match = Object.keys(NAV_ITEM_LABELS).find((p) => {
    if (p === '/') return pathname === '/';
    return pathname.startsWith(p);
  });
  return (match && NAV_ITEM_LABELS[match]) || 'CMS';
}

function SidebarContent({
  repos, selectedRepo, branches, user,
  showRepoDropdown, showBranchDropdown, showAccountDropdown,
  setShowRepoDropdown, setShowBranchDropdown, setShowAccountDropdown,
  onRepoChange, onBranchChange, onSwitchAccount, onLogout, onNewArticle, onNavClick,
  detectingFrameworks
}: {
  repos: DetectedRepo[];
  selectedRepo: { owner: string; repo: string; branch: string } | null;
  branches: string[];
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
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { config } = useCollections();
  const [searchQuery, setSearchQuery] = useState('');

// 有效内容路径（过滤 glob 模式），侧边栏目录树完全由配置驱动
  const validPaths = useMemo(() => filterValidDirs(config.paths || []), [config.paths]);

  // activeDir 仅在内容库路由（/）生效，避免草稿箱/设置等页面误高亮
  const onContent = location.pathname === '/';
  const urlPath = searchParams.get('path');
  const activeDir = onContent
    ? (urlPath && validPaths.includes(urlPath) ? urlPath : (validPaths[0] || ''))
    : '';
  const [expandedDir, setExpandedDir] = useState<string | null>(activeDir || null);

  // 各目录已加载的文件列表、加载态、错误态
  const [dirFiles, setDirFiles] = useState<Record<string, EnhancedFileItem[]>>({});
  const [dirLoading, setDirLoading] = useState<Record<string, boolean>>({});
  const [dirErrors, setDirErrors] = useState<Record<string, boolean>>({});
  // 竞态防护：手风琴同一时间只加载一个目录，用全局递增 id 丢弃过期响应
  const dirLoadIdRef = useRef(0);

  // URL 选中目录变化时同步展开状态（如从编辑器返回）
  useEffect(() => {
    if (activeDir && activeDir !== expandedDir) {
      setExpandedDir(activeDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDir]);

  const loadDirFiles = useCallback((repo: SelectedRepo, dir: string) => {
    const requestId = ++dirLoadIdRef.current;
    setDirLoading(prev => ({ ...prev, [dir]: true }));
    setDirErrors(prev => ({ ...prev, [dir]: false }));
    scanMdFiles(repo, dir)
      .then(files => {
        if (requestId !== dirLoadIdRef.current) return;
        sortByFrontMatterDate(files);
        setCachedFiles(repo, dir, files);
        setDirFiles(prev => ({ ...prev, [dir]: files }));
      })
      .catch(err => {
        if (requestId !== dirLoadIdRef.current) return;
        console.error(`加载目录 ${dir} 失败:`, err);
        setDirFiles(prev => ({ ...prev, [dir]: [] }));
        setDirErrors(prev => ({ ...prev, [dir]: true }));
      })
      .finally(() => {
        if (requestId !== dirLoadIdRef.current) return;
        setDirLoading(prev => ({ ...prev, [dir]: false }));
      });
  }, [scanMdFiles, sortByFrontMatterDate, setCachedFiles]);

  // 展开目录时加载该路径的文章：有缓存直接复用不重复扫描；无缓存才请求（缓解重复全量扫描）
  useEffect(() => {
    if (!expandedDir || !selectedRepo) return;

    const cached = getCachedFiles(selectedRepo, expandedDir);
    if (cached) {
      setDirFiles(prev => ({ ...prev, [expandedDir]: cached }));
      return;
    }
    loadDirFiles(selectedRepo, expandedDir);
  }, [expandedDir, selectedRepo, loadDirFiles]);

  const toggleDir = (dir: string) => {
    if (expandedDir === dir) {
      // 折叠时使在途请求过期并清理组件内状态（全局 fileCache 保留，再展开直接读缓存）
      dirLoadIdRef.current += 1;
      setExpandedDir(null);
      setDirFiles(prev => { const next = { ...prev }; delete next[dir]; return next; });
      setDirLoading(prev => { const next = { ...prev }; delete next[dir]; return next; });
      setDirErrors(prev => { const next = { ...prev }; delete next[dir]; return next; });
    } else {
      setExpandedDir(dir);
      navigate(`/?path=${encodeURIComponent(dir)}`);
    }
  };

  // URL 中的 path 指向已删除目录时清理，避免残留无效参数
  useEffect(() => {
    if (onContent && urlPath && !validPaths.includes(urlPath)) {
      navigate('/', { replace: true });
    }
  }, [onContent, urlPath, validPaths, navigate]);

  const openArticle = (dir: string, file: EnhancedFileItem) => {
    if (!selectedRepo) return;
    const relative = file.path.slice(dir.length + 1);
    navigate(buildEditUrl({
      owner: selectedRepo.owner,
      repo: selectedRepo.repo,
      branch: selectedRepo.branch,
      basePath: dir,
      filePath: relative,
      returnTo: dir
    }));
    onNavClick();
  };

  // 当前正在编辑的文章（用于侧边栏高亮）
  const currentFilePathParam = useMemo(
    () => new URLSearchParams(location.search).get('filePath'),
    [location.search]
  );

  // 下拉框关闭时重置搜索
  useEffect(() => {
    if (!showRepoDropdown) setSearchQuery('');
  }, [showRepoDropdown]);

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

      <div className="px-4 pb-2">
        <div className="relative">
          <button
            onClick={() => { setShowRepoDropdown(!showRepoDropdown); setShowBranchDropdown(false); }}
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
                    placeholder="搜索仓库..."
                    className="w-full pl-7 pr-2 py-1 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-white text-foreground placeholder:text-muted-foreground"
                    autoFocus
                  />
                </div>
              </div>
              {/* 仓库列表 */}
              <div>
                {filteredRepos.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {repos.length === 0 ? '加载中...' : '没有匹配的仓库'}
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
          <div className="relative">
            <button
              onClick={() => { setShowBranchDropdown(!showBranchDropdown); setShowRepoDropdown(false); }}
              disabled={branches.length === 0}
              className="w-full h-8 px-3 text-sm border border-border-subtle bg-accent rounded-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 truncate disabled:opacity-50"
            >
              <span className="truncate">分支: {selectedRepo.branch}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showBranchDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border z-50 max-h-40 overflow-auto">
                {branches.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">加载中...</div>
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

        {/* 内容库：手风琴目录树，由配置的内容路径驱动（未配置则不显示） */}
        {validPaths.length > 0 ? (
          <div className="mb-1">
            {validPaths.map((dir) => {
              const isExpanded = expandedDir === dir;
              const isActiveDir = activeDir === dir;
              const files = dirFiles[dir] || [];
              const isLoading = dirLoading[dir];
              const hasError = dirErrors[dir];
              return (
                <div key={dir}>
                  <button
                    onClick={() => toggleDir(dir)}
                    aria-expanded={isExpanded}
                    className={`w-full flex items-center gap-1.5 px-2 py-2 rounded-sm text-sm transition-colors text-left ${
                      isActiveDir
                        ? 'bg-accent text-foreground font-medium'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    <Folder className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate flex-1">{dir}</span>
                    {isLoading && <Loader2 className="w-3 h-3 text-muted-foreground animate-spin flex-shrink-0" />}
                    {!isLoading && !hasError && files.length > 0 && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">{files.length}</span>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="ml-5 border-l border-border-subtle pl-2">
                      {isLoading && files.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">加载中...</div>
                      ) : hasError && files.length === 0 ? (
                        <button
                          onClick={() => selectedRepo && loadDirFiles(selectedRepo, dir)}
                          className="w-full px-2 py-1.5 text-xs text-destructive text-left hover:bg-accent"
                        >
                          加载失败，点击重试
                        </button>
                      ) : files.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无文章</div>
                      ) : (
                        files.map((file) => {
                          const relative = file.path.slice(dir.length + 1).replace(/\.md$/, '');
                          const isCurrent = currentFilePathParam === relative;
                          return (
                            <button
                              key={file.path}
                              onClick={() => openArticle(dir, file)}
                              className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-left text-sm transition-colors ${
                                isCurrent
                                  ? 'bg-accent text-foreground font-medium'
                                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              }`}
                            >
                              <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              <span className="truncate">{relative.split('/').pop()}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <button
            onClick={() => navigate('/settings')}
            className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            未配置内容路径，去设置添加
          </button>
        )}

        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavClick}
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
          <div className="relative">
            <button
              onClick={() => setShowAccountDropdown(!showAccountDropdown)}
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

export default function MainLayout() {
  const { user, logout } = useAuth();
  const { selectedRepo, setSelectedRepo, branches, loadBranches } = useRepo();
  const location = useLocation();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<DetectedRepo[]>([]);
  const [detectingFrameworks, setDetectingFrameworks] = useState(false);
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const detectedFrameworksRef = useRef(false);

  useEffect(() => {
    if (user) {
      getRepos()
        .then(repos => setRepos(repos))
        .catch(console.error);
    }
  }, [user]);

  useEffect(() => {
    if (repos.length > 0 && !detectedFrameworksRef.current) {
      detectedFrameworksRef.current = true;
      setDetectingFrameworks(true);
      detectFrameworks(repos)
        .then(detectedRepos => setRepos(detectedRepos))
        .catch(console.error)
        .finally(() => setDetectingFrameworks(false));
    }
  }, [repos]);

  useEffect(() => {
    if (selectedRepo && user) {
      loadBranches(selectedRepo.owner, selectedRepo.repo);
    }
  }, [selectedRepo, user, loadBranches]);

  useEffect(() => {
    setSidebarOpen(false);
    setShowRepoDropdown(false);
    setShowBranchDropdown(false);
    setShowAccountDropdown(false);
  }, [location.pathname]);

  const handleRepoChange = useCallback((full_name: string) => {
    const [owner = '', repo = ''] = full_name.split('/');
    const repoInfo = repos.find((r) => r.full_name === full_name);
    setSelectedRepo({ owner, repo, branch: repoInfo?.default_branch || 'main' });
    setShowRepoDropdown(false);
  }, [repos, setSelectedRepo]);

  const handleBranchChange = (branch: string) => {
    if (!selectedRepo) return;
    setSelectedRepo({ ...selectedRepo, branch });
    setShowBranchDropdown(false);
  };

  const handleSwitchAccount = () => {
    logout();
    navigate('/login');
  };

  const handleNewArticle = () => {
    if (selectedRepo) {
      const params = new URLSearchParams({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
        returnTo: 'drafts'
      });
      navigate(`/editor/new?${params}`);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="flex h-full bg-background">
      {/* 桌面端侧边栏 - 隐藏于移动端 */}
      <aside className="hidden md:flex w-[260px] bg-card border-r border-border flex-col flex-shrink-0">
        <SidebarContent
          repos={repos}
          selectedRepo={selectedRepo}
          branches={branches}
          user={user}
          showRepoDropdown={showRepoDropdown}
          showBranchDropdown={showBranchDropdown}
          showAccountDropdown={showAccountDropdown}
          setShowRepoDropdown={setShowRepoDropdown}
          setShowBranchDropdown={setShowBranchDropdown}
          setShowAccountDropdown={setShowAccountDropdown}
          onRepoChange={handleRepoChange}
          onBranchChange={handleBranchChange}
          onSwitchAccount={handleSwitchAccount}
          onLogout={handleLogout}
          onNewArticle={handleNewArticle}
          onNavClick={() => {}}
          detectingFrameworks={detectingFrameworks}
        />
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* 移动端侧边栏抽屉 */}
      <aside className={`fixed top-0 left-0 bottom-0 w-[280px] bg-card z-50 md:hidden transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <SidebarContent
          repos={repos}
          selectedRepo={selectedRepo}
          branches={branches}
          user={user}
          showRepoDropdown={showRepoDropdown}
          showBranchDropdown={showBranchDropdown}
          showAccountDropdown={showAccountDropdown}
          setShowRepoDropdown={setShowRepoDropdown}
          setShowBranchDropdown={setShowBranchDropdown}
          setShowAccountDropdown={setShowAccountDropdown}
          onRepoChange={handleRepoChange}
          onBranchChange={handleBranchChange}
          onSwitchAccount={handleSwitchAccount}
          onLogout={handleLogout}
          onNewArticle={handleNewArticle}
          onNavClick={closeSidebar}
          detectingFrameworks={detectingFrameworks}
        />
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="px-4 md:px-8 h-12 flex items-center justify-between flex-shrink-0 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Bloath</span>
              <span className="text-border">/</span>
              <span className="text-foreground font-medium">{getCurrentNavLabel(location.pathname)}</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
