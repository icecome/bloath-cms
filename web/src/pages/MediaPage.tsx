import { useState, useCallback, useEffect, useMemo, useRef, memo, type CSSProperties } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { useRepo } from '../contexts/RepoContext';
import { useAuth } from '../hooks/useAuth';
import type { UploadMode } from '../../../shared/types';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { getTree, deleteFile, readFile } from '../lib/api';
import { resolveMediaSource, mediaCdnUrl } from '../lib/resolveMediaSource';
import { sortByLastModified } from '../lib/sortFiles';
import { s3ListObjects, s3DeleteObject, s3PublicUrl } from '../lib/s3MediaClient';
import { getMediaS3Config } from '../lib/mediaS3Api';
import { scanAssetReferences, type AssetReference } from '../lib/assetReferences';
import { readSnapshot } from '../lib/fileSnapshot';
import { getCachedFiles } from '../lib/fileCache';
import {
  formatDate,
  formatSize,
  thumbnailPathFor,
  listImageUrlFor,
  registerCdnUrlBuilder,
  isVideoName,
  isDerivedAsset,
  videoEmbedSnippet,
  IMAGE_EXT_RE,
  VIDEO_EXT_RE,
  MEDIA_PAGE_SIZE,
  type MediaFile
} from '../lib/mediaUtils';
import { MediaUploadDialog } from '../components/media/MediaUploadDialog';
import { MediaPreviewDialog } from '../components/media/MediaPreviewDialog';
import { DeleteConfirmDialog } from '../components/media/DeleteConfirmDialog';
import { useMediaUpload } from '../hooks/useMediaUpload';
import {
  Image as ImageIcon,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  X,
  Loader2,
  FileImage,
  Play,
  SlidersHorizontal,
  Search,
  Upload
} from 'lucide-react';

/** 单张媒体卡片（memo）：千级网格下，复制闪烁/横幅/上传态等父级 state 变化
 *  不再重渲全部卡片（P2-20）。props 均为按引用稳定的值或 useCallback 回调。 */
interface MediaCardProps {
  file: MediaFile;
  isVideo: boolean;
  coverUrl: string | null;
  isCopiedUrl: boolean;
  isCopiedMarkdown: boolean;
  onPreview: (file: MediaFile) => void;
  onCopy: (file: MediaFile) => void;
  onCopyMarkdown: (file: MediaFile) => void;
  onDelete: (file: MediaFile) => void;
}

const MediaCard = memo(function MediaCard({
  file, isVideo, coverUrl, isCopiedUrl, isCopiedMarkdown,
  onPreview, onCopy, onCopyMarkdown, onDelete,
}: MediaCardProps) {
  return (
    <div
      className="group border border-border rounded-sm overflow-hidden hover:border-border transition-colors bg-card"
    >
      <div
        className="relative aspect-square bg-accent flex items-center justify-center cursor-pointer overflow-hidden"
        onClick={() => onPreview(file)}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={file.name}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <FileImage className={`w-8 h-8 text-muted-foreground ${coverUrl ? 'hidden' : ''}`} />
        {isVideo && (
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="w-9 h-9 rounded-full bg-black/45 flex items-center justify-center">
              <Play className="w-4 h-4 text-white translate-x-px" />
            </span>
          </span>
        )}
      </div>

      <div className="px-2 py-1.5 border-t border-border">
        <p className="text-xs text-foreground truncate font-mono" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-muted-foreground">{formatSize(file.size)} · {formatDate(file.lastModified)}</p>
      </div>

      {/* 触屏无常驻 hover：窄屏常显操作区，桌面端仅悬浮/聚焦时显示 */}
      <div className="px-2 pb-2 flex gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onCopy(file)}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-border rounded-sm hover:bg-accent transition-colors text-muted-foreground"
          title="复制 URL"
        >
          {isCopiedUrl ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
        </button>
        <button
          type="button"
          onClick={() => onCopyMarkdown(file)}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-border rounded-sm hover:bg-accent transition-colors text-muted-foreground"
          title={isVideo ? '复制嵌入代码' : '复制 Markdown 链接'}
        >
          {isCopiedMarkdown ? <Check className="w-3 h-3 text-success" /> : <span className="text-[10px] font-bold">#</span>}
        </button>
        <button
          type="button"
          onClick={() => onDelete(file)}
          className="flex items-center justify-center px-2 py-1 border border-border rounded-sm hover:bg-destructive/10 hover:border-destructive/25 hover:text-destructive transition-colors text-muted-foreground"
          title="删除"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});

export default function MediaPage() {
  const { user } = useAuth();
  const { mediaConfig, config: collectionsConfig } = useCollections();
  const { selectedRepo } = useRepo();
  const source = useMemo(() => resolveMediaSource(mediaConfig, selectedRepo), [mediaConfig, selectedRepo]);
  // 命名模板：旧 {Y}{m} 语法在加载时一次性迁移为新 {{tag}} 语法（幂等）
  // 模板迁移已移入 useMediaUpload（弹窗内可临时改模板）
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'markdown' | null>(null);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [gridCols, setGridCols] = useState(() => {
    const saved = localStorage.getItem('media-grid-cols');
    return saved ? parseInt(saved, 10) : 5;
  });
  const [mobileCols, setMobileCols] = useState(() => {
    const saved = localStorage.getItem('media-grid-cols-mobile');
    return saved ? parseInt(saved, 10) : 3;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  /** 上传弹窗开关；配置在弹窗内临时持有，关闭后回落到设置页默认值（D2） */
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  /** 文件名筛选（前端过滤，与草稿箱 searchQuery 同形态，不引入新接口） */
  const [nameQuery, setNameQuery] = useState('');

  // 列表加载 / S3 配置探测 / 删除 / 复制等非上传类错误：独立于上传管线的错误槽位
  const [loadError, setLoadError] = useState('');
  /** 删除成功提示（与上传管线的 success 分开，避免两种语义挤在同一横幅里） */
  const [deleteNotice, setDeleteNotice] = useState('');
  /** 删除/上传提示的清除定时器：卸载时需清理，避免在已卸载组件上 setState */
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  /** 显示 2 秒后自动清除（重复调用会重置计时） */
  const flashNotice = useCallback((setter: (v: string) => void, text: string) => {
    setter(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      setter('');
      noticeTimerRef.current = null;
    }, 2000);
  }, []);

  const [deleteConfirm, setDeleteConfirm] = useState<MediaFile | null>(null);
  /** 仓库内全部文件路径（缩略图存在性判定用） */
  const [repoFilePaths, setRepoFilePaths] = useState<Set<string>>(new Set());
  // 删除前的引用检查状态：scanning=检查中；found=有引用待确认
  const [referenceChecking, setReferenceChecking] = useState(false);
  const [assetReferences, setAssetReferences] = useState<AssetReference[] | null>(null);
  // 复制提示的清除定时器：组件卸载时需清理，否则会在已卸载组件上调用 setState，
  // 且快速连续复制时旧定时器会提前清掉新提示
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  /** 显示「已复制」态 2 秒；重复调用会重置计时 */
  const flashCopied = useCallback((sha: string, type: 'url' | 'markdown') => {
    setCopiedId(sha);
    setCopiedType(type);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopiedId(null);
      setCopiedType(null);
      copyTimerRef.current = null;
    }, 2000);
  }, []);

  const isConfigured = source.configured;

  /** 文件名筛选后的列表：前端 includes 匹配，大小写不敏感 */
  const filteredFiles = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, nameQuery]);

  // 筛选条件变化时回到第一页，避免停留在不存在的页码上
  useEffect(() => {
    setCurrentPage(1);
  }, [nameQuery]);

  const handleGridColsChange = (value: number) => {
    setGridCols(value);
    localStorage.setItem('media-grid-cols', String(value));
  };

  const handleMobileColsChange = (value: number) => {
    setMobileCols(value);
    localStorage.setItem('media-grid-cols-mobile', String(value));
    setMobileMenuOpen(false);
  };

  const getCdnUrl = useCallback((path: string) => {
    return mediaCdnUrl(source, mediaConfig, path);
  }, [mediaConfig, source]);

  /** S3 源判定（审查报告 M-A1）：分流上传/列表/删除/复制四个通道。
   *  P1-001：凭据已迁 Worker 侧，本地仅持 publicBaseUrl 外链视图；
   *  服务端前缀与配置状态异步探测。 */
  const isS3Source = mediaConfig.sourceType === 's3';
  const s3View = mediaConfig.s3;
  const [s3Prefix, setS3Prefix] = useState('');
  const [s3Configured, setS3Configured] = useState(false);

  useEffect(() => {
    if (!isS3Source) return;
    let cancelled = false;
    getMediaS3Config()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg) {
          setS3Prefix(cfg.prefix || '');
          setS3Configured(true);
        } else {
          setS3Configured(false);
          setLoadError('请在设置页完成 S3 图床配置（凭据现保存于服务端）');
        }
      })
      .catch(() => { if (!cancelled) setLoadError('S3 图床配置读取失败，请稍后重试'); });
    return () => { cancelled = true; };
  }, [isS3Source]);

  const loadFiles = useCallback(async (silent = false): Promise<MediaFile[] | null> => {
    // S3 经 Worker 代理（服务端持凭据），GitHub 通道才需要登录态
    if (!isConfigured) return null;
    if (!isS3Source && !user) return null;
    if (isS3Source && !s3Configured) return null;
    if (!silent) {
      setLoading(true);
      setLoadError('');
    }
    try {
      let mediaFiles: MediaFile[];

      if (isS3Source) {
        // S3 兼容图床：经代理 ListObjects，外链走 publicBaseUrl
        const entries = await s3ListObjects(s3View ?? { publicBaseUrl: '' }, s3Prefix);
        mediaFiles = entries
          .filter((e) => IMAGE_EXT_RE.test(e.key) || VIDEO_EXT_RE.test(e.key))
          .map((e) => ({
            name: e.key.split('/').pop() || e.key,
            path: e.key,
            sha: String(e.lastModified), // S3 无 blob sha：以 lastModified 作变更标识
            size: e.size,
            url: s3PublicUrl(s3View ?? { publicBaseUrl: '' }, e.key) || '',
            lastModified: e.lastModified
          }));
      } else {
        const treeItems = await getTree({
          owner: source.owner,
          repo: source.repo,
          branch: source.branch,
          mode: 'filename'
        });

        mediaFiles = treeItems.filter((f) => {
          if (source.pathPrefix && !f.path.startsWith(source.pathPrefix + '/')) {
            return false;
          }
          return IMAGE_EXT_RE.test(f.name) || VIDEO_EXT_RE.test(f.name);
        })
          .map((f) => ({
            name: f.name,
            path: f.path,
            sha: f.sha,
            size: f.size,
            url: getCdnUrl(f.path),
            lastModified: f.lastModified || 0
          }));
      }

      // 全仓库路径集合：供 listImageUrlFor 判定缩略图/封面是否存在（thumb-* 同目录约定）
      // 注意必须用「未剔除派生文件」的集合，否则缩略图存在性判定永远失败
      const pathSet = new Set(mediaFiles.map((f) => f.path));
      setRepoFilePaths(pathSet);
      // 注册 CDN builder：缩略图路径 → URL（mediaUtils 不反向依赖 React 上下文）
      registerCdnUrlBuilder((path: string) =>
        isS3Source ? s3PublicUrl(s3View ?? { publicBaseUrl: '' }, path) : getCdnUrl(path)
      );

      // 展示层剔除 thumb-*：它们是上传流程自动生成的派生文件，
      // 此前只按扩展名过滤导致每传一张图就多出一个缩略图卡片
      const display = mediaFiles.filter((f) => !isDerivedAsset(f.name));
      const sorted = sortByLastModified(display);

      if (silent) {
        return sorted;
      }
      setFiles(sorted);
      setCurrentPage(1);
      return sorted;
    } catch (err) {
      if (silent) {
        return null;
      }
      setLoadError(err instanceof Error ? err.message : '媒体列表加载失败，请稍后重试');
      return null;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [user, isConfigured, source, getCdnUrl, isS3Source, s3View, s3Prefix, s3Configured]);

  useEffect(() => {
    if (isConfigured) loadFiles();
  }, [isConfigured, loadFiles]);

  /**
   * 上传管线：从页面内联逻辑抽到 hooks/useMediaUpload，供本页的上传弹窗复用。
   * 弹窗内的「本次上传配置」（模式/质量/重命名模板）在提交时通过 options 传入，
   * 不写回设置页 —— 设置页仍是默认值的唯一权威（D2）。
   */
  const {
    upload: runUpload,
    uploading,
    error: uploadError,
    success,
    transcodeNotice,
    clearError: clearUploadError,
    clearSuccess,
  } = useMediaUpload({
    mediaConfig,
    source,
    login: user?.login ?? null,
    isS3Source,
    s3View,
    loadFiles,
    getCdnUrl,
  });

  /** 错误槽位：列表加载与上传共用一个展示区，删除/加载失败也写这里 */
  const error = uploadError || loadError;

  /**
   * 关闭错误提示：清掉当前实际展示的那一个错误源。
   * error 是 uploadError || loadError 的合并槽位，只清其中一个时
   * 另一个源的错误将无法被用户关闭（关闭按钮点了没反应）。
   */
  const dismissError = useCallback(() => {
    if (uploadError) clearUploadError();
    else setLoadError('');
  }, [uploadError, clearUploadError]);

  const handleUploadDialog = useCallback(
    async (
      files: File[],
      options: { mode: UploadMode; quality: number; renameTemplate: string }
    ) => runUpload(files, options),
    [runUpload]
  );

  const handleDelete = useCallback((file: MediaFile) => {
    if (!user) return;
    setDeleteConfirm(file);
    setAssetReferences(null);
  }, [user]);

  /**
   * 删除前引用检查：扫描内容库文章的 front-matter（快照缓存，无网络）与正文（按需读取），
   * 命中引用时在确认对话框中列出，用户可见「删除会影响哪些文章」后再确认。
   */
  const checkReferences = async () => {
    const file = deleteConfirm;
    if (!file) return;

    setReferenceChecking(true);
    try {
      // 文章数据源：内容库各路径的树级快照缓存（P1-1 落地后列表页已预热）。
      // 快照未预热时（如直接进媒体库）为空列表，front-matter 通道零请求。
      const cachedArticles: EnhancedFileItem[] = [];
      if (selectedRepo) {
        // 优先复用各内容路径的内存缓存（列表页访问过即有）
        const cached = (collectionsConfig.paths || [])
          .map((base: string) => getCachedFiles(selectedRepo, base))
          .filter((list): list is EnhancedFileItem[] => !!list)
          .flat();
        if (cached.length > 0) {
          cachedArticles.push(...cached);
        } else {
          // 内存缓存未命中：从快照恢复增强元数据（无网络）
          const snapshot = readSnapshot(selectedRepo);
          for (const record of Object.values(snapshot.records)) {
            cachedArticles.push({ ...record.item });
          }
        }
      }

      // 正文通道：仅当 front-matter 全未命中时才读正文（控制请求量）。
      // 注意（审查报告 M-A2）：文章在博客仓库（selectedRepo），不在图床仓库（source）——
      // standalone/image-branch 图床场景下二者不同，读正文必须用 selectedRepo。
      const { references } = await scanAssetReferences(cachedArticles, file, cachedArticles.length > 0 && selectedRepo
        ? async (articlePath) => {
            try {
              const { content } = await readFile({
                owner: selectedRepo.owner,
                repo: selectedRepo.repo,
                path: articlePath,
                branch: selectedRepo.branch || 'main',
              });
              return content;
            } catch {
              return null;
            }
          }
        : undefined);
      setAssetReferences(references);
    } catch (err) {
      console.warn('[MediaPage] 引用检查失败（按无引用处理）：', err);
      setAssetReferences([]);
    } finally {
      setReferenceChecking(false);
    }
  };

  const executeDelete = async () => {
    const file = deleteConfirm;
    if (!file || !user) return;
    setDeleteConfirm(null);
    setAssetReferences(null);

    try {
      const thumbPath = thumbnailPathFor(file.path);
      if (isS3Source) {
        // S3 图床：经代理直删对象（含同名缩略图/封面），无 commit
        await s3DeleteObject(s3View ?? { publicBaseUrl: '' }, file.path);
        await s3DeleteObject(s3View ?? { publicBaseUrl: '' }, thumbPath).catch(() => undefined);
      } else {
        await deleteFile({
          owner: source.owner,
          repo: source.repo,
          path: file.path,
          sha: file.sha,
          message: `[skip ci] 删除：${file.name}`,
          userName: user?.login
        });
        // GitHub 通道此前只删原文件，thumb-* 会变成无人可见的孤儿文件
        // （列表不展示、也无入口清理）。缩略图没有 sha 无法直接删，
        // 用「按路径读 sha → 删除」；失败忽略（孤儿缩略图不影响使用）
        try {
          const { sha: thumbSha } = await readFile({
            owner: source.owner,
            repo: source.repo,
            path: thumbPath,
            branch: source.branch || 'main'
          });
          await deleteFile({
            owner: source.owner,
            repo: source.repo,
            path: thumbPath,
            sha: thumbSha,
            message: `[skip ci] 删除缩略图：${thumbPath.split('/').pop()}`,
            userName: user?.login
          });
        } catch {
          // 没有缩略图 / 读取失败：忽略
        }
      }
      setFiles((prev) => prev.filter((f) => f.sha !== file.sha));
      flashNotice(setDeleteNotice, `已删除 ${file.name}`);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '删除失败，请稍后重试');
    }
  };

  const handleCopy = useCallback(async (file: MediaFile) => {
    try {
      await navigator.clipboard.writeText(file.url);
      flashCopied(file.sha, 'url');
    } catch {
      setLoadError('复制失败，请手动选中内容复制');
    }
  }, [flashCopied]);

  const handleCopyMarkdown = useCallback(async (file: MediaFile) => {
    // 视频没有 Markdown 原生语法，改复制 HTML5 嵌入片段
    const text = isVideoName(file.name)
      ? videoEmbedSnippet(file.url)
      : `![${file.name}](${file.url})`;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(file.sha, 'markdown');
    } catch {
      setLoadError('复制失败，请手动选中内容复制');
    }
  }, [flashCopied]);
  if (!isConfigured) {
    return (
      <div className="h-full flex flex-col">
        <header className="px-4 md:px-8 py-5 flex-shrink-0">
          <h1 className="text-base font-medium text-foreground">媒体库</h1>
          <p className="text-sm text-muted-foreground mt-1">管理图片和静态资源</p>
        </header>
        <div className="flex-1 overflow-auto px-4 md:px-8">
          <div className="border border-border rounded-sm p-12 text-center">
            <ImageIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">{source.missingHint || '请先完成媒体库配置'}</p>
            <p className="text-xs text-muted-foreground">先在设置页配置媒体源，即可开始使用</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 md:px-8 py-4 flex-shrink-0 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium text-foreground whitespace-nowrap">媒体库</h1>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="按文件名筛选……"
              aria-label="按文件名筛选媒体库文件"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted text-foreground placeholder-muted-foreground border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={() => setUploadDialogOpen(true)}
            disabled={!isConfigured}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-background bg-foreground rounded-sm hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Upload className="w-4 h-4" />
            上传图片
          </button>
        </div>
      </header>

      {/* 排序行：类型/目录分类已移除（GitHub 源内容平铺，tab 无实际筛选价值），
          仅保留「最近更新」排序与网格列数控制 */}
      <div className="px-4 md:px-8 py-3 flex-shrink-0 flex items-center gap-3 border-b border-border-subtle">
        <span className="text-xs text-muted-foreground whitespace-nowrap">最近更新</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {isS3Source ? 'S3 图床' : `${source.owner}/${source.repo}`} · {filteredFiles.length} 个文件
        </span>
        <div className="ml-auto relative flex items-center gap-3">
          <SlidersHorizontal className="w-4 h-4 text-muted-foreground hidden sm:block" />
          <span className="text-xs text-muted-foreground w-16 hidden sm:inline">每行 {gridCols} 个</span>
          <input
            type="range"
            min={5}
            max={10}
            value={gridCols}
            onChange={(e) => handleGridColsChange(parseInt(e.target.value, 10))}
            className="w-24 h-1 accent-primary cursor-pointer hidden sm:block"
          />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((o) => !o)}
            className="sm:hidden flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:bg-accent transition-colors"
            aria-expanded={mobileMenuOpen}
            aria-label="设置每行列数"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>每行 {mobileCols} 个</span>
          </button>
          {mobileMenuOpen && (
            <div className="absolute top-full right-0 mt-1 bg-card border border-border z-50 min-w-[120px] p-1.5 shadow-lg">
              <p className="text-xs text-muted-foreground mb-1.5 px-1.5">每行列数</p>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleMobileColsChange(n)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-accent rounded-sm transition-colors"
                >
                  <Check className={`w-3.5 h-3.5 ${mobileCols === n ? 'text-foreground' : 'opacity-0'}`} />
                  <span>{n} 列</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-8 space-y-4">
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border border-destructive/25 rounded-sm text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="whitespace-pre-line flex-1">{error}</span>
            <button type="button" onClick={dismissError} className="ml-auto flex-shrink-0" aria-label="关闭错误提示"><X className="w-3 h-3" /></button>
          </div>
        )}
        {transcodeNotice && (
          <div className="flex items-start gap-2 px-3 py-2 bg-accent border border-border rounded-sm text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 animate-spin" />
            <span className="whitespace-pre-line flex-1">{transcodeNotice}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 px-3 py-2 bg-success/10 border border-success/25 rounded-sm text-xs text-success">
            <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="whitespace-pre-line flex-1">{success}</span>
            <button type="button" onClick={() => clearSuccess()} className="ml-auto flex-shrink-0" aria-label="关闭成功提示"><X className="w-3 h-3" /></button>
          </div>
        )}

        {deleteNotice && (
          <div className="flex items-start gap-2 px-3 py-2 bg-success/10 border border-success/25 rounded-sm text-xs text-success">
            <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="whitespace-pre-line flex-1">{deleteNotice}</span>
            <button type="button" onClick={() => setDeleteNotice('')} className="ml-auto flex-shrink-0" aria-label="关闭成功提示"><X className="w-3 h-3" /></button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            暂无文件。点击右上「上传图片」开始使用
          </div>
        ) : (
          <>
            <div
              className="media-grid"
              style={{ '--pgrid': String(gridCols), '--mgrid': String(mobileCols) } as CSSProperties}
            >
            {filteredFiles.slice(0, currentPage * MEDIA_PAGE_SIZE).map((file) => (
              <MediaCard
                key={file.path}
                file={file}
                isVideo={isVideoName(file.name)}
                coverUrl={listImageUrlFor(file, repoFilePaths)}
                isCopiedUrl={copiedId === file.sha && copiedType === 'url'}
                isCopiedMarkdown={copiedId === file.sha && copiedType === 'markdown'}
                onPreview={setPreviewFile}
                onCopy={handleCopy}
                onCopyMarkdown={handleCopyMarkdown}
                onDelete={handleDelete}
              />
            ))}
          </div>
            {filteredFiles.length > currentPage * MEDIA_PAGE_SIZE && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="px-6 py-2 text-sm bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
                >
                  加载更多，剩余 {filteredFiles.length - currentPage * MEDIA_PAGE_SIZE} 个
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <DeleteConfirmDialog
        file={deleteConfirm}
        references={assetReferences}
        checking={referenceChecking}
        onCheck={checkReferences}
        onCancel={() => {
          setDeleteConfirm(null);
          setAssetReferences(null);
        }}
        onConfirm={executeDelete}
      />

      <MediaPreviewDialog
        file={previewFile}
        copiedId={copiedId}
        copiedType={copiedType}
        onClose={() => setPreviewFile(null)}
        onCopyUrl={handleCopy}
        onCopyMarkdown={handleCopyMarkdown}
        onDelete={handleDelete}
      />

      <MediaUploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        defaultMode={mediaConfig.uploadMode}
        defaultQuality={mediaConfig.quality}
        defaultRenameTemplate={mediaConfig.renameTemplate}
        onUpload={handleUploadDialog}
        uploading={uploading}
        error={uploadError}
        onClearError={clearUploadError}
      />
    </div>
  );
}
