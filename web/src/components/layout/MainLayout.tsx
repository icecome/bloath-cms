import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRepo } from '../../contexts/RepoContext';
import { getRepos } from '../../lib/api';
import { useState, useEffect } from 'react';
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
  Trash2
} from 'lucide-react';

export default function MainLayout() {
  const { user, logout, token } = useAuth();
  const { selectedRepo, setSelectedRepo, branches, loadBranches } = useRepo();
  const location = useLocation();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<any[]>([]);
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);

  useEffect(() => {
    if (token) {
      getRepos(token).then(setRepos).catch(console.error);
    }
  }, [token]);

  // 当仓库变化时，加载分支列表
  useEffect(() => {
    if (selectedRepo && token) {
      loadBranches(selectedRepo.owner, selectedRepo.repo, token);
    }
  }, [selectedRepo, token, loadBranches]);

  const handleRepoChange = (full_name: string) => {
    const [owner, repo] = full_name.split('/');
    const repoInfo = repos.find((r: any) => r.full_name === full_name);
    setSelectedRepo({ owner, repo, branch: repoInfo?.default_branch || 'main' });
    setShowRepoDropdown(false);
  };

  const handleBranchChange = (branch: string) => {
    if (!selectedRepo) return;
    setSelectedRepo({ ...selectedRepo, branch });
    setShowBranchDropdown(false);
  };

  const handleSwitchAccount = () => {
    logout();
    navigate('/login');
  };

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
    <div className="flex h-full bg-[#FAFAFA]">
      {/* 侧边栏 - 扁平设计，260px */}
      <aside className="w-[260px] bg-white border-r border-[#E8E8E8] flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-5 py-4 flex items-center gap-2.5">
          <div className="w-6 h-6 flex items-center justify-center">
            <span className="text-lg font-bold text-[#1F1F1F]">B</span>
          </div>
          <span className="text-sm font-semibold text-[#1F1F1F]">Bloath CMS</span>
        </div>

        {/* 新建文章按钮 - 扁平黑色 */}
        <div className="px-4 pb-3">
          <button
            onClick={() => {
              if (selectedRepo) {
                navigate(`/editor/new?owner=${selectedRepo.owner}&repo=${selectedRepo.repo}&branch=${selectedRepo.branch}`);
              }
            }}
            disabled={!selectedRepo}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1F1F1F] rounded-sm hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>新建文章</span>
          </button>
        </div>

        {/* 仓库选择器 - 极细边框 */}
        <div className="px-4 pb-2">
          <div className="relative">
            <button
              onClick={() => {
                setShowRepoDropdown(!showRepoDropdown);
                setShowBranchDropdown(false);
              }}
              className="w-full h-9 px-3 text-sm border border-[#E8E8E8] rounded-sm text-[#374151] hover:bg-[#F9FAFA] transition-colors flex items-center gap-2 truncate"
            >
              <Folder className="w-4 h-4 text-[#6B7280] flex-shrink-0" />
              <span className="truncate">
                {selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : '选择仓库'}
              </span>
              <ChevronDown className={`w-4 h-4 text-[#6B7280] flex-shrink-0 transition-transform ${showRepoDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {showRepoDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E8E8E8] z-50 max-h-48 overflow-auto">
                {repos.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-[#6B7280]">加载中...</div>
                ) : (
                  repos.map((repo: any) => (
                    <button
                      key={repo.full_name}
                      onClick={() => handleRepoChange(repo.full_name)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#F9FAFA] transition-colors border-b border-[#F2F2F2] last:border-b-0 ${
                        selectedRepo?.owner === repo.owner && selectedRepo?.repo === repo.repo
                          ? 'text-[#1F1F1F] font-medium'
                          : 'text-[#374151]'
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

        {/* 分支选择器 - 极淡背景 */}
        {selectedRepo && (
          <div className="px-4 pb-2">
            <div className="relative">
              <button
                onClick={() => {
                  setShowBranchDropdown(!showBranchDropdown);
                  setShowRepoDropdown(false);
                }}
                disabled={branches.length === 0}
                className="w-full h-8 px-3 text-sm border border-[#F2F2F2] bg-[#F9FAFA] rounded-sm text-[#374151] hover:bg-[#F3F4F6] transition-colors flex items-center gap-2 truncate disabled:opacity-50"
              >
                <span className="truncate">
                  分支: {selectedRepo.branch}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-[#6B7280] flex-shrink-0 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              {showBranchDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E8E8E8] z-50 max-h-40 overflow-auto">
                  {branches.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-[#6B7280]">加载中...</div>
                  ) : (
                    branches.map((branch: string) => (
                      <button
                        key={branch}
                        onClick={() => handleBranchChange(branch)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#F9FAFA] transition-colors ${
                          selectedRepo?.branch === branch
                            ? 'text-[#1F1F1F] font-medium'
                            : 'text-[#374151]'
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
        <div className="mx-4 border-t border-[#F2F2F2]"></div>

        {/* 导航菜单 - 极简列表 */}
        <nav className="px-2 py-2 flex-1">
          <div className="px-3 py-1.5 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
            内容
          </div>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2 px-3 py-2 rounded-sm text-sm transition-colors ${
                isActive(item.path)
                  ? 'bg-[#F9FAFA] text-[#1F1F1F] font-medium'
                  : 'text-[#374151] hover:bg-[#F3F4F6]'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {/* 底部固定区域 */}
        <div className="border-t border-[#F2F2F2] px-4 py-3">
          {/* 用户信息 */}
          {user && (
            <div className="relative">
              <button
                onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                className="w-full flex items-center gap-2 hover:bg-[#F9FAFA] rounded-sm p-2 transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-sm overflow-hidden flex-shrink-0">
                  <img src={user.avatar_url} alt={user.login} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1F1F1F] truncate">{user.name || user.login}</p>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-[#6B7280] flex-shrink-0 transition-transform ${showAccountDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              {showAccountDropdown && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-[#E8E8E8] z-50">
                  <div className="px-3 py-2 border-b border-[#F2F2F2]">
                    <p className="text-sm font-medium text-[#1F1F1F]">{user.name || user.login}</p>
                    <p className="text-sm text-[#6B7280]">@{user.login}</p>
                  </div>
                  <div className="py-1">
                    <button
                      onClick={handleSwitchAccount}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[#F9FAFA] transition-colors text-[#374151]"
                    >
                      <Users className="w-4 h-4" />
                      切换账号
                    </button>
                    <button
                      onClick={() => {
                        logout();
                        navigate('/login');
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[#F9FAFA] transition-colors text-[#6B7280]"
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
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部 Header - 面包屑导航 */}
        <header className="px-8 h-12 flex items-center justify-between flex-shrink-0 border-b border-[#F2F2F2]">
          <div className="flex items-center gap-2 text-xs text-[#6B7280]">
            <span>Bloath</span>
            <span className="text-[#D1D5DB]">/</span>
            <span className="text-[#1F1F1F] font-medium">
              {navItems.find((item) => isActive(item.path))?.label || 'CMS'}
            </span>
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
