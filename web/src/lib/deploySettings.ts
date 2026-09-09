// 部署策略：auto = 写正式内容的 commit 触发 CI；manual = 全部 [skip ci]，由用户手动触发部署
export type DeployStrategy = 'auto' | 'manual';

const STORAGE_KEY = 'bloath_deploy_strategy';
const SKIP_CI_PREFIX = '[skip ci] ';

export function getDeployStrategy(): DeployStrategy {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'manual' || stored === 'auto') return stored;
  } catch {
    // ignore
  }
  return 'auto';
}

export function setDeployStrategy(strategy: DeployStrategy): void {
  try {
    localStorage.setItem(STORAGE_KEY, strategy);
  } catch {
    // ignore
  }
}

/**
 * 生成 commit message：
 * - 显式 skipCi=true：恒加前缀（草稿/回收站等不应触发 CI 的操作）
 * - 未显式指定时按部署策略：manual 下全部跳过 CI，由用户手动触发部署
 */
export function buildCommitMessage(base: string, options?: { skipCi?: boolean }): string {
  const skip = options?.skipCi ?? getDeployStrategy() === 'manual';
  return skip ? `${SKIP_CI_PREFIX}${base}` : base;
}
