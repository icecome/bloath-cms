// 布局壳：桌面侧栏 + 移动端抽屉 + 顶栏（面包屑 / 主题 / 部署状态）+ 路由出口。
//
// 【2026-11-12 拆分】SidebarContent 已抽到 ./SidebarContent.tsx（原文件 716 行含 2 组件）。
// 本文件现在只保留布局壳自身的责任：
//   · 仓库列表拉取与框架识别（网络副作用）
//   · 仓库配置同步（.bloath/config.json 拉取与护栏）
//   · 分支加载、主题切换、全局搜索对话框、路由变化时的浮层收敛
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRepo } from '../../contexts/RepoContext';
import { useCollections } from '../../contexts/CollectionsContext';
import { getRepos } from '../../lib/api';
import { useState, useEffect, useCallback, useRef } from 'react';
import { detectFrameworks, type DetectedRepo } from '../../lib/detectFramework';
import { pullRepoConfig, sanitizeSyncedConfig, isSafeToOverwriteMedia } from '../../lib/repoConfigSync';
import { filterValidDirs } from '../../lib/path';
import { DeployBadge } from './DeployBadge';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import { SidebarContent, type RepoListError } from './SidebarContent';
import { getCurrentNavLabel } from './navLabels';
import { Menu, X, Sun, Moon } from 'lucide-react';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const { selectedRepo, setSelectedRepo, branches, loadingBranches, loadBranches } = useRepo();
  const { updateConfig, updateMediaConfig, config: layoutCollectionsConfig } = useCollections();
  const location = useLocation();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<DetectedRepo[]>([]);
  /**
   * 仓库列表加载/失败状态。旧实现只有 `repos` 一个数组，用 `repos.length === 0`
   * 冒充 loading —— 仓库确实为 0 或请求失败时，下拉框永远停在「加载中……」。
   */
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [reposError, setReposError] = useState<RepoListError>(null);
  const [detectingFrameworks, setDetectingFrameworks] = useState(false);
  const [frameworkError, setFrameworkError] = useState<string | null>(null);
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 全局搜索对话框（Ctrl/Cmd+K 或顶栏搜索按钮） */
  const [searchOpen, setSearchOpen] = useState(false);
  // 主题状态与 documentElement 上的 .dark 类互为镜像：初始值读类而非再解析
  // localStorage——index.html 内联脚本已在首屏前完成「存储/系统偏好 → 类」的判定
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = useCallback(() => {
    // m-10：副作用（classList / localStorage）此前写在 setState updater 内——
    // updater 必须是纯函数，React 在并发渲染下可能多次调用它，副作用会被重复执行。
    // 改为「先算新值 → setState → 副作用在外部执行一次」。
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    // 持久化用户显式选择；未操作过时保持跟随系统的初始判定
    localStorage.setItem('bloath_theme', next ? 'dark' : 'light');
  }, [dark]);

  const detectedFrameworksRef = useRef(false);
  const syncedRepoKeyRef = useRef('');

  // Ctrl/Cmd+K 打开全局搜索
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 切换仓库时自动拉取仓库内配置（.bloath/config.json），仓库为准实现多设备同步
  useEffect(() => {
    if (!selectedRepo || !user) return;
    const key = `${selectedRepo.owner}/${selectedRepo.repo}@${selectedRepo.branch}`;
    if (syncedRepoKeyRef.current === key) return;
    syncedRepoKeyRef.current = key;
    const { owner, repo, branch } = selectedRepo;
    pullRepoConfig(owner, repo, branch)
      .then((remote) => {
        // 拉取期间仓库已切换：丢弃过期结果，避免覆盖当前仓库配置。
        // m-09：校验必须含 branch——同仓库不同分支的配置可能不同（如预发布分支），
        // 只比 owner/repo 会让旧分支的迟到响应覆盖新分支配置。
        if (!selectedRepo || selectedRepo.owner !== owner || selectedRepo.repo !== repo
            || selectedRepo.branch !== branch) return;
        if (!remote) return;
        // 剥离历史版本可能已写入仓库文件的 S3 凭据，防止污染本地存储（P1-004）
        const clean = sanitizeSyncedConfig(remote);
        if (clean.collections) {
          const { paths, draftPath, trashPath } = clean.collections;
          updateConfig({
            ...(paths && paths.length > 0 ? { paths } : {}),
            ...(draftPath ? { draftPath } : {}),
            ...(trashPath ? { trashPath } : {})
          });
        }
        if (clean.media) {
          // 护栏：仓库配置若是并行多桶上线前的旧结构（无 backends），直接用它会
          // 把本地 backends 清空 → 用户已保存的 S3/图床后端在切仓库后集体消失。
          // 仅在仓库侧确实提供了非空 backends 时才覆盖，否则保留本地配置并留日志。
          if (isSafeToOverwriteMedia(clean.media)) {
            updateMediaConfig(clean.media);
          } else {
            console.info(
              '[MainLayout] 仓库 .bloath/config.json 的 media 未包含 backends，'
              + '已跳过覆盖以保留本地媒体仓库配置；如需以仓库为准请先在设置页推送一次配置'
            );
          }
        }
      })
      .catch((err) => console.error('拉取仓库配置失败：', err));
  }, [selectedRepo, user, updateConfig, updateMediaConfig]);

  /**
   * 拉取仓库列表。抽成 useCallback 以便「重试」按钮复用。
   *
   * 失败必须落到 UI（AGENTS.md §6.5 禁止静默失败）：旧实现 `.catch(console.error)`
   * 只进控制台，界面停在「加载中……」且无出口。
   */
  const loadRepos = useCallback(() => {
    if (!user) {
      setLoadingRepos(false);
      return;
    }
    setLoadingRepos(true);
    setReposError(null);
    getRepos()
      .then((list) => { setRepos(list); })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '未知错误';
        setReposError(message);
        console.error('拉取仓库列表失败：', err);
      })
      .finally(() => { setLoadingRepos(false); });
  }, [user]);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  // 框架识别：失败不再静默。识别结果只影响仓库名旁的框架徽标，
  // 失败时保留原始仓库列表并按提示告知，用户可据此判断是网络问题还是仓库不支持。
  useEffect(() => {
    if (repos.length > 0 && !detectedFrameworksRef.current) {
      detectedFrameworksRef.current = true;
      setDetectingFrameworks(true);
      setFrameworkError(null);
      detectFrameworks(repos)
        .then(detectedRepos => setRepos(detectedRepos))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : '未知错误';
          setFrameworkError(message);
          console.error('框架识别失败：', err);
        })
        .finally(() => setDetectingFrameworks(false));
    }
  }, [repos]);

  // 重试仓库列表时重置框架识别闸门，否则新列表不会被重新识别
  const handleRetryRepos = useCallback(() => {
    detectedFrameworksRef.current = false;
    setFrameworkError(null);
    loadRepos();
  }, [loadRepos]);

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

  const currentNavLabel = getCurrentNavLabel(location.pathname);

  const sidebarProps = {
    repos,
    loadingRepos,
    reposError: reposError ?? frameworkError,
    onRetryRepos: handleRetryRepos,
    selectedRepo,
    branches,
    loadingBranches,
    user,
    showRepoDropdown,
    showBranchDropdown,
    showAccountDropdown,
    setShowRepoDropdown,
    setShowBranchDropdown,
    setShowAccountDropdown,
    onRepoChange: handleRepoChange,
    onBranchChange: handleBranchChange,
    onSwitchAccount: handleSwitchAccount,
    onLogout: handleLogout,
    onNewArticle: handleNewArticle,
    detectingFrameworks,
    onOpenSearch: () => setSearchOpen(true),
  };

  return (
    <div className="flex h-full bg-background">
      {/* 桌面端侧边栏 - 隐藏于移动端 */}
      <aside className="hidden md:flex w-[260px] bg-card border-r border-border flex-col flex-shrink-0">
        <SidebarContent {...sidebarProps} onNavClick={() => {}} />
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* 移动端侧边栏抽屉 */}
      <aside className={`fixed top-0 left-0 bottom-0 w-[280px] bg-card z-50 md:hidden transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <SidebarContent {...sidebarProps} onNavClick={closeSidebar} />
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="px-4 md:px-8 h-12 flex items-center justify-between flex-shrink-0 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? '关闭菜单' : '打开菜单'}
              aria-expanded={sidebarOpen}
              className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Bloath</span>
              {/* 未知路由不渲染空面包屑段（旧实现回退成类目词「CMS」，零信息量） */}
              {currentNavLabel && (
                <>
                  <span className="text-border">/</span>
                  <span className="text-foreground font-medium">{currentNavLabel}</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? '切换浅色模式' : '切换深色模式'}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-sm transition-colors"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          {selectedRepo && <DeployBadge repo={selectedRepo} />}
        </header>

        {selectedRepo && (
          <GlobalSearchDialog
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            repo={selectedRepo}
            contentPaths={filterValidDirs(layoutCollectionsConfig.paths || [])}
            draftPath={layoutCollectionsConfig.draftPath}
          />
        )}

        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
