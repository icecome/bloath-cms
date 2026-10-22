// 部署状态查询：拉取仓库最近 Actions runs，产出给前端展示的部署状态。
//
// 设计（对齐 Sveltia deployments/poll.js 的「轮询 + 超时给手动重查」语义）：
// - 调用方传入 gitToken（来自会话），后端只读最近 5 次 run（per_page=5，轻量）；
// - 只取 workflow_runs 顶层状态字段，不展开 steps（避免响应膨胀）；
// - 失败（GitHub 不可达/无权限）返回空数组 + 错误信息，不抛错。
import type { WorkflowInfo } from './github';

/** 单次 Actions run 的前端展示视图（仅取展示所需字段） */
export interface DeployRunView {
  id: number;
  /** workflow 显示名 */
  name: string;
  /** 触发分支 */
  headBranch: string;
  /** 状态：queued / in_progress / success / failure / cancelled */
  status: 'queued' | 'in_progress' | 'completed' | 'cancelled' | 'unknown';
  /** 结论：success/failure/cancelled/skipped（status=completed 时有值） */
  conclusion: string | null;
  /** 触发时间 ISO 字符串 */
  createdAt: string;
  /** 完成 ISO 字符串（可能为空） */
  updatedAt: string;
  /** run 详情页 URL（前端可跳转） */
  htmlUrl: string;
  /** 对应的 commit message 摘要 */
  displayTitle: string;
}

export interface DeployStatusResult {
  runs: DeployRunView[];
  /** GitHub 侧或解析错误时的说明，无错误为空字符串 */
  error: string;
}

interface WorkflowRunApiResponse {
  id: number;
  name?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  display_title?: string;
}

/**
 * 拉取最近 Actions runs。失败时返回空 runs + 错误说明，不抛错（调用方降级显示）。
 */
export async function fetchRecentRuns(
  fetchFn: typeof fetch,
  token: string,
  owner: string,
  repo: string
): Promise<DeployStatusResult> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=5`;
    const resp = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'bloath-cms-worker',
      },
    });

    if (!resp.ok) {
      return { runs: [], error: `GitHub 返回 ${resp.status}` };
    }

    const data = (await resp.json()) as { workflow_runs?: WorkflowRunApiResponse[] };
    const rawRuns = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];

    const runs: DeployRunView[] = rawRuns.map((r) => ({
      id: r.id,
      name: r.name ?? '',
      headBranch: r.head_branch ?? '',
      status: normalizeStatus(r.status),
      conclusion: r.conclusion ?? null,
      createdAt: r.created_at ?? '',
      updatedAt: r.updated_at ?? '',
      htmlUrl: r.html_url ?? '',
      displayTitle: r.display_title ?? '',
    }));

    return { runs, error: '' };
  } catch (err) {
    return { runs: [], error: (err as Error).message || '部署状态查询失败' };
  }
}

export function normalizeStatus(raw: string | undefined): DeployRunView['status'] {
  if (raw === 'queued') return 'queued';
  if (raw === 'in_progress') return 'in_progress';
  if (raw === 'completed') return 'completed';
  if (raw === 'cancelled') return 'cancelled';
  return 'unknown';
}

// workflows 过滤助手：仅保留 active 状态（供手动触发下拉）
export interface WorkflowOption extends WorkflowInfo {}

export function toWorkflowOptions(workflows: WorkflowInfo[]): WorkflowOption[] {
  return workflows.filter((w) => w.state === 'active');
}
