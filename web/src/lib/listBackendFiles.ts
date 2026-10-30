// 按 backend id 列举该后端的媒体文件（供上传管线的重名判定使用）。
//
// 为什么必须是独立函数而非「复用当前浏览仓库的列表」：并行媒体仓库下，
// 上传目标后端 ≠ 当前浏览的仓库，用后者的列表做重名判定会把目标仓库里
// 不存在的同名文件误判为「已存在」而跳过上传。
//
// 纯函数模块（无 React 依赖），可被 node 原生测试直接加载。
import type { MediaConfig, SelectedRepo } from '../../../shared/types';
import { getTree } from './api';
import { s3ListObjects, s3PublicUrl } from './s3MediaClient';
import { getMediaS3Config } from './mediaS3Api';
import { resolveMediaBackend, mediaCdnUrl } from './resolveMediaSource';
import { IMAGE_EXT_RE, VIDEO_EXT_RE, type MediaFile } from './mediaUtils';

/**
 * 列出指定后端的媒体文件；失败返回 null（调用方按「无既有文件」处理）。
 * S3 后端经 Worker 代理列举（凭据在服务端），GitHub 类走后端定位的 Trees API。
 */
export async function listBackendFiles(
  config: MediaConfig,
  backendId: string,
  selectedRepo: SelectedRepo | null
): Promise<MediaFile[] | null> {
  const backend = (config.backends || []).find((b) => b.id === backendId);
  if (!backend) return null;
  try {
    if (backend.kind === 's3') {
      const cfg = await getMediaS3Config(backendId);
      if (!cfg) return null;
      const view = { publicBaseUrl: backend.s3PublicBaseUrl || '', backendId };
      const entries = await s3ListObjects(view, cfg.prefix || '');
      return entries
        .filter((e) => IMAGE_EXT_RE.test(e.key) || VIDEO_EXT_RE.test(e.key))
        .map((e) => ({
          name: e.key.split('/').pop() || e.key,
          path: e.key,
          sha: String(e.lastModified),
          size: e.size,
          url: s3PublicUrl(view, e.key) || '',
          lastModified: e.lastModified,
        }));
    }
    const bSource = resolveMediaBackend(config, backendId, selectedRepo);
    if (!bSource.configured) return null;
    const treeItems = await getTree({
      owner: bSource.owner,
      repo: bSource.repo,
      branch: bSource.branch,
      mode: 'filename',
    });
    return treeItems
      .filter((f) => {
        if (bSource.pathPrefix && !f.path.startsWith(bSource.pathPrefix + '/')) return false;
        return IMAGE_EXT_RE.test(f.name) || VIDEO_EXT_RE.test(f.name);
      })
      .map((f) => ({
        name: f.name,
        path: f.path,
        sha: f.sha,
        size: f.size,
        url: mediaCdnUrl(bSource, config, f.path),
        lastModified: f.lastModified || 0,
      }));
  } catch (err) {
    // 列举失败按「无既有文件」处理：不阻断上传（重名判定退化为不跳过）。
    // 但必须留 warn 让用户/开发者可定位「为何同名文件被覆盖」——静默返回 null
    // 会让重名策略在故障时静默降级为 overwrite，用户无感知（审查 m-03）。
    console.warn('[listBackendFiles] 列举失败，重名判定降级为「全部覆盖」：', err);
    return null;
  }
}
