// 并行媒体仓库解析（零依赖纯函数模块，供 node 原生测试链路直接加载）。
//
// 为什么独立于 resolveMediaSource.ts：该文件导入 constants.ts（内部读
// import.meta.env，Vite 专属），node --experimental-strip-types 测试链路无法解析，
// 导致解析逻辑长期不可测。本模块只依赖 shared/types 与自身常量，可直接 node 测试。
//
// 与 resolveMediaSource.ts 的关系：后者 re-export 本模块的函数，保持既有导入点兼容。
import type { MediaBackend, MediaConfig, SelectedRepo } from '../../../shared/types';

// 与 web/src/lib/constants.ts 保持一致；该文件不能导入（见文件头注释）
const DEFAULT_MEDIA_PATH = 'assets';
const DEFAULT_BRANCH_NAME = 'assets';
const DEFAULT_STANDALONE_BRANCH = 'main';

// 解析后的媒体源定位信息
export interface ResolvedMediaSource {
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
  configured: boolean;
  missingHint?: string;
}

/** 按 kind 解析单个 backend 的定位信息（内部公共逻辑） */
function resolveBackendByKind(
  kind: MediaBackend['kind'],
  selectedRepo: SelectedRepo | null,
  loc: { owner?: string; repo?: string; branch?: string; pathPrefix?: string }
): ResolvedMediaSource {
  switch (kind) {
    case 'standalone': {
      const owner = loc.owner || '';
      const repo = loc.repo || '';
      const configured = !!(owner && repo);
      return {
        owner,
        repo,
        branch: loc.branch || DEFAULT_STANDALONE_BRANCH,
        pathPrefix: '',
        configured,
        missingHint: configured ? undefined : '请在设置页配置图床仓库的所有者和仓库名',
      };
    }
    case 'repo-dir': {
      if (!selectedRepo) {
        return {
          owner: '', repo: '', branch: 'main', pathPrefix: '',
          configured: false,
          missingHint: '请先在侧边栏选择博客仓库',
        };
      }
      const pathPrefix = (loc.pathPrefix || DEFAULT_MEDIA_PATH).replace(/^\/+|\/+$/g, '');
      return {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch || 'main',
        pathPrefix,
        configured: true,
      };
    }
    case 'image-branch': {
      if (!selectedRepo) {
        return {
          owner: '', repo: '', branch: '', pathPrefix: '',
          configured: false,
          missingHint: '请先在侧边栏选择博客仓库',
        };
      }
      return {
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: loc.branch || DEFAULT_BRANCH_NAME,
        pathPrefix: '',
        configured: true,
      };
    }
    case 's3': {
      // S3 源不走 GitHub 路径体系：返回占位 source，调用方按 kind 分流到
      // s3MediaClient 代理（P1-001：凭据已迁 Worker 侧，浏览器不判配置完整性——
      // 配置状态由 /api/media/s3/config 返回，页面异步探测）
      return {
        owner: '', repo: '', branch: '', pathPrefix: '',
        configured: true,
        missingHint: undefined,
      };
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`未处理的媒体源类型：${_exhaustive}`);
    }
  }
}

/**
 * 并行媒体仓库：按 backendId 解析单个 backend 的定位信息。
 * - backendId 找不到时回退到默认后端；列表为空返回未配置态。
 * - 返回 source 用于 GitHub 类后端的上传/列举/删除；
 *   S3 后端返回占位 source，由调用方按 kind 走 s3 代理。
 */
export function resolveMediaBackend(
  config: MediaConfig,
  backendId: string,
  selectedRepo: SelectedRepo | null
): ResolvedMediaSource {
  const backends = config.backends || [];
  const target =
    backends.find((b) => b.id === backendId) ||
    backends.find((b) => b.id === config.defaultBackendId) ||
    backends[0];
  if (!target) {
    return {
      owner: '', repo: '', branch: '', pathPrefix: '',
      configured: false,
      missingHint: '请先在设置页配置媒体仓库',
    };
  }
  return resolveBackendByKind(target.kind, selectedRepo, {
    owner: target.owner,
    repo: target.repo,
    branch: target.branch,
    pathPrefix: target.pathPrefix,
  });
}

/**
 * 旧入口：按单源 sourceType 解析。保留为兼容层——新代码应使用
 * resolveMediaBackend(config, backendId, selectedRepo)。
 */
export function resolveMediaSource(
  config: MediaConfig,
  selectedRepo: SelectedRepo | null
): ResolvedMediaSource {
  const backends = config.backends || [];
  if (backends.length > 0) {
    const target = backends.find((b) => b.id === config.defaultBackendId) || backends[0];
    if (target) return resolveMediaBackend(config, target.id, selectedRepo);
  }
  // 并行列表为空（旧配置尚未迁移）：按 sourceType 走旧路径
  return resolveBackendByKind(config.sourceType, selectedRepo, {
    owner: config.imageOwner,
    repo: config.imageRepo,
    branch: config.imageBranch,
    pathPrefix: config.mediaPath,
  });
}

/** 取某个 backend 对象；找不到返回 undefined（调用方可用于显示 label） */
export function getBackend(config: MediaConfig, backendId: string): MediaBackend | undefined {
  const backends = config.backends || [];
  return (
    backends.find((b) => b.id === backendId) ||
    backends.find((b) => b.id === config.defaultBackendId) ||
    backends[0]
  );
}

/** 启用中的 backend 列表（上传下拉 / 页面切换器用） */
export function enabledBackends(config: MediaConfig): MediaBackend[] {
  return (config.backends || []).filter((b) => b.enabled);
}

// CDN 外链拼接保留在此模块外（resolveMediaSource.ts）：它依赖 constants 的
// cdnProvider 语义，但本质是纯字符串拼接，如需测试可再抽离。
