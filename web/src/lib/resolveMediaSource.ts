// 媒体源定位（re-export 层）：实际逻辑在 mediaBackendResolve.ts（零依赖纯函数，
// 可被 node 原生测试直接加载）。本文件保留既有导入点兼容，并承载 CDN 外链拼接
// （mediaCdnUrl，依赖 constants 的 cdnProvider 语义）。
import type { MediaConfig } from '../../../shared/types';

export {
  resolveMediaSource, resolveMediaBackend, resolveBackendSource,
  getBackend, enabledBackends,
  type ResolvedMediaSource,
} from './mediaBackendResolve';

// Re-export 时需要类型名，TS 下需要显式 re-export 上面的 ResolvedMediaSource
import type { ResolvedMediaSource } from './mediaBackendResolve';

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
