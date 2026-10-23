// 部署状态徽章：顶栏显示最近一次 Actions run 的状态，点击跳转 run 详情。
//
// 设计（对齐 Sveltia deployments/poll.js 的轮询语义）：
// - 提交/手动触发后，30s 起轮询、指数退避（30s → 60s → 120s，上限 5 分钟），最多 10 次；
// - 进行中持续轮询，全部完成后停止；点击徽章手动重查；
// - 查询失败（无 Actions / 私仓权限不足）静默隐藏徽章，不影响主流程。
import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { SelectedRepo } from '../../../../shared/types';
import { getDeployStatus, type DeployRunView } from '../../lib/api';

const POLL_INTERVALS_MS = [30_000, 60_000, 120_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000];

function badgeLabel(run: DeployRunView): string {
  if (run.status === 'queued') return '排队中';
  if (run.status === 'in_progress') return '部署中';
  if (run.status === 'completed') {
    if (run.conclusion === 'success') return '已部署';
    if (run.conclusion === 'failure') return '部署失败';
    if (run.conclusion === 'cancelled') return '已取消';
    return '已完成';
  }
  return '';
}

function badgeClass(run: DeployRunView): string {
  if (run.status === 'in_progress' || run.status === 'queued') return 'bg-blue-100 text-blue-700';
  if (run.status === 'completed' && run.conclusion === 'success') return 'bg-green-100 text-green-700';
  if (run.status === 'completed' && run.conclusion === 'failure') return 'bg-red-100 text-red-700';
  return 'bg-secondary text-muted-foreground';
}

export function DeployBadge({ repo }: { repo: SelectedRepo }) {
  const [latestRun, setLatestRun] = useState<DeployRunView | null>(null);
  /** 查询失败原因（网络/权限/未配置 Actions）。非空时显示可点诊断态，而不是静默消失 */
  const [failureReason, setFailureReason] = useState('');
  /** 进行中时的轮询序号（对 POLL_INTERVALS_MS 取模）；空闲为 -1 */
  const [pollTick, setPollTick] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async (): Promise<{ run: DeployRunView | null; reason: string }> => {
    try {
      const result = await getDeployStatus({ owner: repo.owner, repo: repo.repo });
      const run = result.runs.find((r) => r.headBranch === repo.branch) ?? result.runs[0] ?? null;
      // worker 侧失败会带 error 字段（GitHub 不可达/无权限），保留给 UI 展示
      return { run, reason: run ? '' : result.error || '' };
    } catch (err) {
      return { run: null, reason: err instanceof Error ? err.message : '部署状态查询失败' };
    }
  }, [repo.owner, repo.repo, repo.branch]);

  // 挂载/仓库切换时拉一次
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    fetchStatus().then(({ run, reason }) => {
      if (cancelled) return;
      setLatestRun(run);
      setFailureReason(reason);
      // 首拉即处于进行中：进入轮询
      if (run && (run.status === 'queued' || run.status === 'in_progress')) {
        setPollTick(0);
      } else {
        setPollTick(-1);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchStatus]);

  // 轮询：进行中按间隔重查，完成/超次停止
  useEffect(() => {
    if (pollTick < 0 || pollTick >= POLL_INTERVALS_MS.length) return;

    timerRef.current = setTimeout(async () => {
      const { run, reason } = await fetchStatus();
      if (!mountedRef.current) return;
      setLatestRun(run);
      setFailureReason(reason);

      const stillBusy = run && (run.status === 'queued' || run.status === 'in_progress');
      if (stillBusy) {
        setPollTick((t) => t + 1);
      } else {
        setPollTick(-1);
      }
    }, POLL_INTERVALS_MS[pollTick]);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pollTick, fetchStatus]);

  // 失败态：显示「部署状态不可用」并给出原因，避免用户以为功能不存在
  if (!latestRun) {
    if (!failureReason) return null;
    return (
      <a
        href={`https://github.com/${repo.owner}/${repo.repo}/actions`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        title={`部署状态不可用：${failureReason}（点击查看 Actions）`}
      >
        <span className="px-1.5 py-0.5 rounded-sm bg-secondary text-muted-foreground">部署状态不可用</span>
      </a>
    );
  }

  const label = badgeLabel(latestRun);
  if (!label) return null;

  return (
    <a
      href={latestRun.htmlUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={`最近部署：${latestRun.displayTitle || latestRun.name}（点击查看详情）`}
    >
      <span className={`px-1.5 py-0.5 rounded-sm text-[11px] font-medium ${badgeClass(latestRun)}`}>
        {label}
      </span>
      {(latestRun.status === 'in_progress' || latestRun.status === 'queued') && (
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
      )}
    </a>
  );
}
