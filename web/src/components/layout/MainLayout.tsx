import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRepo } from '../../contexts/RepoContext';
import { getRepos } from '../../lib/api';
import { useState, useEffect, useCallback } from 'react';
import type { Repo } from '../../../../shared/types';
import {
  Home,
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
  Menu,
  X
} from 'lucide-react';

// 侧边栏内容组件（桌面端和移动端共用）
function SidebarContent({
  repos, selectedRepo, branches, user,
  showRepoDropdown, showBranchDropdown, showAccountDropdown,
  setShowRepoDropdown, setShowBranchDropdown, setShowAccountDropdown,
  onRepoChange, onBranchChange, onSwitchAccount, onLogout, onNewArticle, onNavClick
}: {
  repos: Repo[];
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
}) {
  const location = useLocation();

  const navItems = [
    { path: '/', label: '内容库', icon: <Home className="w-4 h-4" /> },
    { path: '/drafts', label: '草稿箱', icon: <FilePlus2 className="w-4 h-4" /> },
    { path: '/trash', label: '回收站', icon: <Trash2 className="w-4 h-4" /> },
    { path: '/media', label: '媒体库', icon: <ImageIcon className="w-4 h-4" /> },
    { path: '/settings', label: '设置', icon: <Settings className="w-4 h-4" /> },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-4 flex items-center gap-2.5">
        <div className="w-6 h-6 flex items-center justify-center">
          <span className="text-lg font-bold text-foreground">B</span>
        </div>
        <span className="text-sm font-semibold text-foreground">Bloath CMS</span>
      </div>

      {/* 新建文章按钮 */}
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

      {/* 仓库选择器 */}
      <div className="px-4 pb-2">
        <div className="relative">
          <button
            onClick={() => { setShowRepoDropdown(!showRepoDropdown); setShowBranchDropdown(false); }}
            className="w-full h-9 px-3 text-sm border border-border rounded-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2 truncate"
          >
            <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate">
              {selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : '选择仓库'}
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${showRepoDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showRepoDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border z-50 max-h-48 overflow-auto">
              {repos.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">加载中...</div>
              ) : (
                repos.map((repo: any) => (
                  <button
                    key={repo.full_name}
                    onClick={() => { onRepoChange(repo.full_name); onNavClick(); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors border-b border-border-subtle last:border-b-0 ${
                      selectedRepo?.owner === repo.owner && selectedRepo?.repo === repo.repo
                        ? 'text-foreground font-medium'
                        : 'text-foreground'
                    }`}
                  >
                    {selectedRepo?.owner === repo.owner && selectedRepo?.repo === repo.repo && (
                      <Check className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span className="truncate">{repo.full_name}</span>
                  </button>
                ))
              )}
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

      {/* 分隔线 */}
      <div className="mx-4 border-t border-border-subtle"></div>

      {/* 导航菜单 */}
      <nav className="px-2 py-2 flex-1">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">内容</div>
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

      {/* 底部用户信息 */}
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
  const [repos, setRepos] = useState<Repo[]>([]);
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (user) {
      getRepos().then(setRepos).catch(console.error);
    }
  }, [user]);

  useEffect(() => {
    if (selectedRepo && user) {
      loadBranches(selectedRepo.owner, selectedRepo.repo);
    }
  }, [selectedRepo, user, loadBranches]);

  // 路由变化时关闭侧边栏
  useEffect(() => {
    setSidebarOpen(false);
    setShowRepoDropdown(false);
    setShowBranchDropdown(false);
    setShowAccountDropdown(false);
  }, [location.pathname]);

  const handleRepoChange = useCallback((full_name: string) => {
    const [owner, repo] = full_name.split('/');
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
      navigate(`/editor/new?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}&returnTo=drafts`);
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
        />
      </aside>

      {/* 移动端侧边栏遮罩 */}
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
        />
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部 Header */}
        <header className="px-4 md:px-8 h-12 flex items-center justify-between flex-shrink-0 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            {/* 移动端汉堡菜单按钮 */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Bloath</span>
              <span className="text-border">/</span>
              <span className="text-foreground font-medium">
                {['/', '/drafts', '/trash', '/media', '/settings'].find(p => {
                  if (p === '/') return location.pathname === '/';
                  return location.pathname.startsWith(p);
                }) ? (() => {
                  const navLabels: Record<string, string> = { '/': '内容库', '/drafts': '草稿箱', '/trash': '回收站', '/media': '媒体库', '/settings': '设置' };
                  return navLabels[['/', '/drafts', '/trash', '/media', '/settings'].find(p => {
                    if (p === '/') return location.pathname === '/';
                    return location.pathname.startsWith(p);
                  }) || '/'];
                })() : 'CMS'}
              </span>
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
