// 配置仓库化同步：集合路径 / 图床配置存入仓库 .bloath/config.json
// 策略：切换仓库时自动拉取（仓库为准），本地修改后由设置页手动推送，避免写入回环
import { readFile, writeFile } from './api';
import { HttpError } from './http';
import type { MediaConfig } from '../../../shared/types';

export const REPO_CONFIG_PATH = '.bloath/config.json';

export interface RepoSyncedConfig {
  version: 1;
  collections?: {
    paths?: string[];
    /** 已废弃：零消费字段（P2 裁剪），保留为可选只为解析旧文件不报错 */
    label?: string;
    draftPath?: string;
    trashPath?: string;
  };
  media?: MediaConfig;
}

/**
 * 推送前剥离 S3 凭据：.bloath/config.json 会随仓库提交，博客仓库通常是公开的，
 * AccessKey/Secret 一旦写入即公开泄露。剥离是双保险——上游 SettingsPage 传入的
 * mediaConfig 含完整 s3 对象，此处是凭据进仓库的最后一道闸（P1-004 审计已核验）。
 */
function stripMediaCredentials(media: MediaConfig): MediaConfig {
  if (!media.s3) return media;
  const { s3: _s3, ...rest } = media;
  return rest as MediaConfig;
}

/** 拉取侧凭据剥离：旧版本推送的 config.json 可能已含 s3 凭据，
 *  不得让其进入本地 mediaConfig（否则污染 localStorage 明文存储） */
export function sanitizeSyncedConfig(config: RepoSyncedConfig): RepoSyncedConfig {
  if (!config.media?.s3) return config;
  const { media, ...rest } = config;
  const { s3: _s3, ...mediaRest } = media;
  return { ...rest, media: mediaRest as MediaConfig };
}

/** 按状态码判断「文件不存在」，不匹配 message 文本 */
function isNotFound(err: unknown): boolean {
  return err instanceof HttpError && err.status === 404;
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
      console.error('[repoConfigSync] 拉取配置失败：', err);
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
    content: JSON.stringify({ ...config, media: config.media ? stripMediaCredentials(config.media) : undefined }, null, 2),
    message: '[skip ci] 同步 Bloath 配置',
    branch,
    sha,
    userName
  });
}
