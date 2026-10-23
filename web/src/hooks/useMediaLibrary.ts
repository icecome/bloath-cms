// 媒体库列表加载（共享 hook）：媒体库页与「从媒体库选择」对话框共用同一份分流逻辑。
//
// 为什么需要抽出来：存储后端不同 → 数据通道不同，但「列表」语义相同：
//   · S3 兼容图床：浏览器直连 ListObjectsV2（s3MediaClient），URL 走 publicBaseUrl，
//     不经过 Worker，也不需要登录会话（凭据在 MediaConfig.s3）。
//   · GitHub 四种形态：Worker 代理 Trees API（getTree），URL 由 CDN 模板拼装，
//     需要登录会话。
// 分流放在这一层，UI 层就不再写 sourceType 分支。
//
// 历史原因：MediaPickerDialog 只写了 GitHub 通道（getTree + mediaCdnUrl），而 S3 源下
// source.owner/repo/branch 均为空串，选择器必然拿到空列表或 400——不是「S3 不支持选择」，
// 是选择器漏了分流。本 hook 即为修复点。
//
// 与 MediaPage 的关系：同一套逻辑此前内联在 MediaPage.loadFiles 中（列表/上传/删除共用）。
// 本 hook 先承接「列表」职责供选择器使用；MediaPage 迁移到本 hook 属于后续重构，
// 迁移时注意 loadFiles 还承担 upload 后的 silent 刷新（保留 silent 参数即为此）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTree } from '../lib/api';
import { useAuth } from './useAuth';
import { useCollections } from '../contexts/CollectionsContext';
import { useRepo } from '../contexts/RepoContext';
import { resolveMediaSource, mediaCdnUrl } from '../lib/resolveMediaSource';
import { s3ListObjects, s3PublicUrl } from '../lib/s3MediaClient';
import { s3MediaPrefix } from '../lib/resolveS3MediaSource';
import { sortByLastModified } from '../lib/sortFiles';
import {
  IMAGE_EXT_RE,
  THUMBNAIL_PREFIX,
  registerCdnUrlBuilder,
  type MediaFile,
  type MediaKind,
} from '../lib/mediaUtils';

/** 选择器/列表需要的过滤口径：'all' = 图片 + 视频 */
export type MediaKindFilter = MediaKind | 'all';

export interface MediaLibraryItem extends MediaFile {
  /** 文件类型（由扩展名判定，用于渲染分支与插入语法） */
  kind: MediaKind;
}

export interface UseMediaLibraryResult {
  items: MediaLibraryItem[];
  /** 仓库/桶内全部媒体路径（含 thumb-*），供 listImageUrlFor 判定缩略图存在性 */
  repoFilePaths: Set<string>;
  loading: boolean;
  error: string;
  /** 媒体源是否配置完整（false 时不应发起请求） */
  isConfigured: boolean;
  /** 存储后端是否为 S3（UI 可据此提示 CDN/上限差异） */
  isS3Source: boolean;
  /**
   * 重新加载。
   * @param silent true = 不切 loading、不覆盖 error（上传后静默刷新用）
   */
  reload: (silent?: boolean) => Promise<MediaLibraryItem[] | null>;
}

/** 扩展名 → kind；非媒体返回 null */
function kindOf(name: string): MediaKind | null {
  if (/\.(mp4|m4v|webm|ogv|ogg|mov)$/i.test(name)) return 'video';
  if (IMAGE_EXT_RE.test(name)) return 'image';
  return null;
}

/**
 * 加载媒体库列表。
 * @param kind 只返回该类型（'all' 返回图片 + 视频）
 * @param enabled false 时不自动加载（对话框未打开时省一次请求）
 */
export function useMediaLibrary(
  kind: MediaKindFilter = 'all',
  enabled = true
): UseMediaLibraryResult {
  const { user } = useAuth();
  const { mediaConfig } = useCollections();
  const { selectedRepo } = useRepo();

  const source = useMemo(
    () => resolveMediaSource(mediaConfig, selectedRepo),
    [mediaConfig, selectedRepo]
  );
  const isS3Source = mediaConfig.sourceType === 's3';
  const s3Config = mediaConfig.s3;
  const s3Prefix = useMemo(() => s3MediaPrefix(mediaConfig), [mediaConfig]);

  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [repoFilePaths, setRepoFilePaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 陈旧响应防护：每次加载自增序号，落地前比对；同时用于卸载后阻止 setState
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (silent = false): Promise<MediaLibraryItem[] | null> => {
      if (!source.configured) return null;
      // S3 走浏览器直连（凭据在本地配置），GitHub 通道才需要会话
      if (!isS3Source && !user) return null;

      const requestId = ++requestIdRef.current;
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        /** 未过滤的原始条目：名称/路径/URL 三要素 */
        let all: MediaFile[];

        if (isS3Source && s3Config) {
          const entries = await s3ListObjects(s3Config, s3Prefix);
          all = entries
            .filter((e) => kindOf(e.key) !== null)
            .map((e) => ({
              name: e.key.split('/').pop() || e.key,
              path: e.key,
              // S3 无 blob sha：以 lastModified 作变更标识（与 MediaPage 一致）
              sha: String(e.lastModified),
              size: e.size,
              url: s3PublicUrl(s3Config, e.key) || '',
              lastModified: e.lastModified,
            }));
        } else {
          const treeItems = await getTree({
            owner: source.owner,
            repo: source.repo,
            branch: source.branch,
            mode: 'filename',
          });
          all = treeItems
            .filter((f) => {
              if (source.pathPrefix && !f.path.startsWith(source.pathPrefix + '/')) return false;
              return kindOf(f.name) !== null;
            })
            .map((f) => ({
              name: f.name,
              path: f.path,
              sha: f.sha,
              size: f.size,
              url: mediaCdnUrl(source, mediaConfig, f.path),
              lastModified: f.lastModified || 0,
            }));
        }

        if (requestId !== requestIdRef.current) return null;

        // 路径集合必须包含缩略图（thumb-*），否则 listImageUrlFor 会永远回退原图
        setRepoFilePaths(new Set(all.map((f) => f.path)));

        // 注册 CDN builder：缩略图路径 → URL（mediaUtils 不反向依赖 React 上下文）
        registerCdnUrlBuilder((path: string) =>
          isS3Source && s3Config ? s3PublicUrl(s3Config, path) : mediaCdnUrl(source, mediaConfig, path)
        );

        // 展示项：剔除派生产物（thumb-*）与类型不匹配的文件，再按更新时间倒序
        const display: MediaLibraryItem[] = [];
        for (const file of all) {
          if (file.name.startsWith(THUMBNAIL_PREFIX)) continue;
          const fileKind = kindOf(file.name);
          if (!fileKind) continue;
          if (kind !== 'all' && fileKind !== kind) continue;
          display.push({ ...file, kind: fileKind });
        }
        const sorted = sortByLastModified(display);

        if (requestId !== requestIdRef.current) return null;
        setItems(sorted);
        setError('');
        return sorted;
      } catch (err) {
        if (requestId !== requestIdRef.current) return null;
        const message = err instanceof Error ? err.message : '媒体库加载失败，请稍后重试';
        if (!silent) setError(message);
        return null;
      } finally {
        if (requestId === requestIdRef.current && !silent) setLoading(false);
      }
    },
    [source, isS3Source, s3Config, s3Prefix, user, mediaConfig, kind]
  );

  // 作废在途请求（卸载/依赖变更/关闭对话框）：seq 自增后，旧请求落地时会因 id 不匹配被丢弃。
  // 抽成 useCallback 而不是在 cleanup 里直接读 ref：语义相同，且静态检查不会误报。
  const invalidate = useCallback(() => {
    requestIdRef.current++;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    return invalidate;
  }, [enabled, load, invalidate]);

  return { items, repoFilePaths, loading, error, isConfigured: source.configured, isS3Source, reload: load };
}

