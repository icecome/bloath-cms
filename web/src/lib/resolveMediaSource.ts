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
  if (cdnProvider === 'jsdelivr') {
    return `https://testingcf.jsdelivr.net/gh/${owner}/${repo}@${branch}/${encodedPath}`;
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
        missingHint: configured ? undefined : '请在设置页配置图床仓库的所有者和仓库名'
      };
    }
    case 'repo-dir': {
      if (!selectedRepo) {
        return {
          owner: '', repo: '', branch: 'main', pathPrefix: '',
          configured: false,
          missingHint: '请先在侧边栏选择博客仓库'
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
          missingHint: '请先在侧边栏选择博客仓库'
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
    case 's3': {
      // S3 源不走 GitHub 路径体系：返回占位 source，MediaPage 按 sourceType 分流到
      // s3MediaClient 代理（P1-001：凭据已迁 Worker 侧，浏览器不判配置完整性——
      // 配置状态由 /api/media/s3/config 返回，页面异步探测）
      return {
        owner: '', repo: '', branch: '', pathPrefix: '',
        configured: true,
        missingHint: undefined
      };
    }
    default: {
      // never 穷举检查：新增 MediaSourceType 时编译器会在此报错
      const _exhaustive: never = config.sourceType;
      throw new Error(`未处理的媒体源类型：${_exhaustive}`);
    }
  }
}
