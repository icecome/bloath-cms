// 配置仓库化同步：集合路径 / 图床配置存入仓库 .bloath/config.json
// 策略：切换仓库时自动拉取（仓库为准），本地修改后由设置页手动推送，避免写入回环
import { readFile, writeFile } from './api';
import type { MediaConfig } from '../../../shared/types';

export const REPO_CONFIG_PATH = '.bloath/config.json';

export interface RepoSyncedConfig {
  version: 1;
  collections?: {
    paths?: string[];
    label?: string;
    draftPath?: string;
    trashPath?: string;
  };
  media?: MediaConfig;
}

function isNotFound(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('404') || msg.includes('not found');
}

/** 拉取仓库配置；不存在或非法时返回 null */
export async function pullRepoConfig(
  owner: string,
  repo: string,
  branch: string
): Promise<RepoSyncedConfig | null> {
  try {
    const { content } = await readFile({ owner, repo, path: REPO_CONFIG_PATH, branch });
    const parsed = JSON.parse(content) as RepoSyncedConfig;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;
    return parsed;
  } catch (err) {
    if (!isNotFound(err)) {
      console.error('[repoConfigSync] 拉取配置失败:', err);
    }
    return null;
  }
}

/** 推送仓库配置（自动处理已有文件的 sha） */
export async function pushRepoConfig(
  owner: string,
  repo: string,
  branch: string,
  config: RepoSyncedConfig,
  userName?: string
): Promise<void> {
  let sha: string | undefined;
  try {
    const existing = await readFile({ owner, repo, path: REPO_CONFIG_PATH, branch });
    sha = existing.sha || undefined;
  } catch {
    // 文件不存在则新建
  }

  await writeFile({
    owner,
    repo,
    path: REPO_CONFIG_PATH,
    content: JSON.stringify(config, null, 2),
    message: '[skip ci] 同步 Bloath 配置',
    branch,
    sha,
    userName
  });
}
