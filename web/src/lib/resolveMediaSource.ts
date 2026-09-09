import type { MediaConfig, SelectedRepo } from '../../../shared/types';
import { DEFAULT_MEDIA_PATH, DEFAULT_BRANCH_NAME, DEFAULT_STANDALONE_BRANCH } from './constants';

// 解析后的媒体源定位信息
export interface ResolvedMediaSource {
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
  configured: boolean;
  missingHint?: string;
}

// 按媒体配置把仓库内路径解析为可访问 URL
export function mediaCdnUrl(source: ResolvedMediaSource, config: MediaConfig, path: string): string {
  const { cdnProvider, customCdnTemplate } = config;
  const { owner, repo, branch } = source;
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  if (cdnProvider === 'custom') {
    return customCdnTemplate
      .split('{owner}').join(owner)
      .split('{repo}').join(repo)
      .split('{branch}').join(branch)
      .split('{path}').join(encodedPath);
  }
  if (cdnProvider === 'jsdmirror') {
    return `https://cdn.jsdmirror.cn/gh/${owner}/${repo}@${branch}/${encodedPath}`;
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`;
}

export function resolveMediaSource(
  config: MediaConfig,
  selectedRepo: SelectedRepo | null
): ResolvedMediaSource {
  switch (config.sourceType) {
    case 'standalone': {
      const configured = !!(config.imageOwner && config.imageRepo);
      return {
        owner: config.imageOwner,
        repo: config.imageRepo,
        branch: config.imageBranch || DEFAULT_STANDALONE_BRANCH,
        pathPrefix: '',
        configured,
        missingHint: configured ? undefined : '请在设置页配置图床仓库所有者和仓库名'
      };
    }
    case 'repo-dir': {
      if (!selectedRepo) {
        return {
          owner: '', repo: '', branch: 'main', pathPrefix: '',
          configured: false,
          missingHint: '请先在仪表盘选择博客仓库'
        };
      }
      const pathPrefix = (config.mediaPath || DEFAULT_MEDIA_PATH).replace(/^\/+|\/+$/g, '');
      return {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch || 'main',
        pathPrefix,
        configured: true
      };
    }
    case 'image-branch': {
      if (!selectedRepo) {
        return {
          owner: '', repo: '', branch: '', pathPrefix: '',
          configured: false,
          missingHint: '请先在仪表盘选择博客仓库'
        };
      }
      return {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: config.imageBranchName || DEFAULT_BRANCH_NAME,
        pathPrefix: '',
        configured: true
      };
    }
    default: {
      // never 穷举检查：新增 MediaSourceType 时编译器会在此报错
      const _exhaustive: never = config.sourceType;
      throw new Error(`未处理的媒体源类型: ${_exhaustive}`);
    }
  }
}
