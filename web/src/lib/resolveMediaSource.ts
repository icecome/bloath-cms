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
