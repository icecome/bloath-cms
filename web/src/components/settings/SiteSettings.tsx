// 站点设置：Profile 切换 + 部署策略 + 手动触发部署
import { useState, useEffect, useCallback } from 'react';
import { useRepo } from '../../contexts/RepoContext';
import { useCollections } from '../../contexts/CollectionsContext';
import { getWorkflows, triggerDeploy, type WorkflowInfo } from '../../lib/api';
import {
  getProfileForRepo, setProfileOverride, clearProfileOverride, getStoredProfileRef
} from '../../lib/profileService';
import { invalidateDetectCache } from '../../lib/detectFramework';
import { listProfiles, type ProfileId } from '../../../../shared/profiles';
import { getDeployStrategy, setDeployStrategy, type DeployStrategy } from '../../lib/deploySettings';
import { useToast } from '../../contexts/ToastContext';
import { Loader2, Rocket } from 'lucide-react';

export function SiteSettings() {
  const { selectedRepo } = useRepo();
  const { config, updateConfig } = useCollections();
  const { addToast } = useToast();

  const [profileId, setProfileId] = useState<ProfileId>('custom');
  const [profileSource, setProfileSource] = useState<'detected' | 'manual'>('detected');
  const [profileLoading, setProfileLoading] = useState(false);

  const [strategy, setStrategy] = useState<DeployStrategy>(() => getDeployStrategy());
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [deploying, setDeploying] = useState(false);

  // 加载当前仓库生效的 Profile
  useEffect(() => {
    if (!selectedRepo) return;
    let cancelled = false;
    const stored = getStoredProfileRef(selectedRepo.owner, selectedRepo.repo);
    if (stored) {
      setProfileId(stored.id);
      setProfileSource(stored.detected ? 'detected' : 'manual');
      return;
    }
    setProfileLoading(true);
    getProfileForRepo(selectedRepo.owner, selectedRepo.repo, selectedRepo.branch)
      .then((p) => {
        if (cancelled) return;
        setProfileId(p.id);
        const ref = getStoredProfileRef(selectedRepo.owner, selectedRepo.repo);
        setProfileSource(ref?.detected === false ? 'manual' : 'detected');
      })
      .catch(() => { /* 保持默认 */ })
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRepo]);

  // 加载可用 workflows（手动部署）
  useEffect(() => {
    if (!selectedRepo) return;
    let cancelled = false;
    setWorkflowsLoading(true);
    getWorkflows(selectedRepo.owner, selectedRepo.repo)
      .then((list) => {
        if (cancelled) return;
        setWorkflows(list);
        setSelectedWorkflowId(list[0]?.id ?? null);
      })
      .catch(() => { if (!cancelled) setWorkflows([]); })
      .finally(() => { if (!cancelled) setWorkflowsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRepo]);

  const handleProfileChange = useCallback((id: ProfileId) => {
    setProfileId(id);
    setProfileSource('manual');
    if (!selectedRepo) return;
    setProfileOverride(selectedRepo.owner, selectedRepo.repo, id);
    addToast({ message: `已切换站点 Profile：${id}`, type: 'success' });
  }, [selectedRepo, addToast]);

  const handleRedetect = useCallback(() => {
    if (!selectedRepo) return;
    clearProfileOverride(selectedRepo.owner, selectedRepo.repo);
    invalidateDetectCache(selectedRepo.owner, selectedRepo.repo, selectedRepo.branch);
    setProfileLoading(true);
    getProfileForRepo(selectedRepo.owner, selectedRepo.repo, selectedRepo.branch)
      .then((p) => {
        setProfileId(p.id);
        setProfileSource('detected');
        addToast({ message: `已重新识别：${p.label}`, type: 'success' });
      })
      .catch(() => { /* ignore */ })
      .finally(() => setProfileLoading(false));
  }, [selectedRepo, addToast]);

  const handleApplyContentPaths = useCallback(() => {
    const profile = listProfiles().find((p) => p.id === profileId);
    if (!profile || profile.contentPaths.length === 0) return;
    updateConfig({ paths: [...profile.contentPaths] });
    addToast({ message: `已应用 ${profile.label} 内容路径：${profile.contentPaths.join(', ')}`, type: 'success' });
  }, [profileId, updateConfig, addToast]);

  const handleStrategyChange = useCallback((next: DeployStrategy) => {
    setStrategy(next);
    setDeployStrategy(next);
    addToast({
      message: next === 'auto'
        ? '已切换为自动部署：写正式内容的 commit 将触发 CI'
        : '已切换为手动部署：所有提交默认跳过 CI，需手动触发部署',
      type: 'success'
    });
  }, [addToast]);

  const handleDeploy = useCallback(async () => {
    if (!selectedRepo || selectedWorkflowId === null) return;
    setDeploying(true);
    try {
      await triggerDeploy({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        workflowId: selectedWorkflowId,
        ref: selectedRepo.branch
      });
      addToast({ message: '部署已触发，可在 GitHub Actions 查看进度', type: 'success' });
    } catch (err) {
      addToast({
        message: `触发失败: ${(err as Error).message}。请确认 workflow 含 workflow_dispatch 触发器。`,
        type: 'error'
      });
    } finally {
      setDeploying(false);
    }
  }, [selectedRepo, selectedWorkflowId, addToast]);

  return (
    <div className="space-y-8 max-w-xl">
      {/* 站点 Profile */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">站点 Profile</h3>
        <p className="text-xs text-muted-foreground">
          决定编辑器表单字段与 front-matter 格式（YAML/TOML）。自动识别失败或站点结构特殊时可手动指定。
        </p>
        {!selectedRepo ? (
          <p className="text-xs text-muted-foreground">请先选择仓库</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={profileId}
                onChange={(e) => handleProfileChange(e.target.value as ProfileId)}
                className="px-2.5 py-1.5 text-xs border border-border rounded-sm bg-card text-foreground focus:outline-none focus:border-primary"
              >
                {listProfiles().map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              {profileLoading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
              <span className="text-xs text-muted-foreground">
                {profileSource === 'detected' ? '（自动识别）' : '（手动指定）'}
              </span>
              {profileSource === 'manual' && (
                <button onClick={handleRedetect} className="text-xs text-primary hover:underline">
                  重新识别
                </button>
              )}
            </div>
            <button
              onClick={handleApplyContentPaths}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              应用该框架推荐内容路径（当前：{config.paths.join(', ')}）
            </button>
          </div>
        )}
      </section>

      {/* 部署策略 */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">部署策略</h3>
        <div className="space-y-1.5">
          {([
            { value: 'auto', label: '自动部署', desc: '保存/发布正式内容时触发 CI 部署（草稿与回收站操作始终跳过）' },
            { value: 'manual', label: '手动部署', desc: '所有提交默认跳过 CI，写完后在下方手动触发部署' }
          ] as Array<{ value: DeployStrategy; label: string; desc: string }>).map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="deploy-strategy"
                checked={strategy === opt.value}
                onChange={() => handleStrategyChange(opt.value)}
                className="mt-0.5"
              />
              <span>
                <span className="text-xs text-foreground">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* 手动部署 */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">手动部署</h3>
        {!selectedRepo ? (
          <p className="text-xs text-muted-foreground">请先选择仓库</p>
        ) : workflowsLoading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载 workflows...
          </p>
        ) : workflows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            仓库中没有可用的 GitHub Actions workflow。手动部署需要在仓库 .github/workflows/ 下配置含
            workflow_dispatch 触发器的部署 workflow。
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={selectedWorkflowId ?? ''}
              onChange={(e) => setSelectedWorkflowId(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs border border-border rounded-sm bg-card text-foreground focus:outline-none focus:border-primary"
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>{w.name}（{w.path}）</option>
              ))}
            </select>
            <button
              onClick={handleDeploy}
              disabled={deploying || selectedWorkflowId === null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors"
            >
              <Rocket className="w-3.5 h-3.5" />
              {deploying ? '触发中...' : `部署 ${selectedRepo.branch}`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
