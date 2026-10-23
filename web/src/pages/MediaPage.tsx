import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { useRepo } from '../contexts/RepoContext';
import { useAuth } from '../hooks/useAuth';
import type { UploadMode } from '../../../shared/types';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import { getTree, uploadImage, uploadMediaBinary, deleteFile, readFile } from '../lib/api';
import { resolveMediaSource, mediaCdnUrl } from '../lib/resolveMediaSource';
import { sortByLastModified } from '../lib/sortFiles';
import { fillTemplate, fillPathTemplate, migrateLegacyTemplate } from '../lib/template';
import { s3ListObjects, s3PutObject, s3DeleteObject, s3PublicUrl } from '../lib/s3MediaClient';
import { s3MediaPrefix } from '../lib/resolveS3MediaSource';
import { scanAssetReferences, type AssetReference } from '../lib/assetReferences';
import { readSnapshot } from '../lib/fileSnapshot';
import { getCachedFiles } from '../lib/fileCache';
import { planUpload, type UploadPlan } from '../lib/mediaUploadPlan';
import { videoMaxBytes, formatMegabytes } from '../lib/mediaLimits';
import { mapLimit } from '../lib/concurrency';
import {
  compressImage,
  blobToBase64,
  formatDate,
  formatSize,
  createThumbnail,
  createVideoPoster,
  thumbnailPathFor,
  listImageUrlFor,
  registerCdnUrlBuilder,
  sanitizeMediaFileName,
  isVideoName,
  isDerivedAsset,
  videoEmbedSnippet,
  IMAGE_EXT_RE,
  VIDEO_EXT_RE,
  MEDIA_PAGE_SIZE,
  type MediaFile
} from '../lib/mediaUtils';
import { MediaUploader } from '../components/media/MediaUploader';
import { MediaPreviewDialog } from '../components/media/MediaPreviewDialog';
import { DeleteConfirmDialog } from '../components/media/DeleteConfirmDialog';
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
  SlidersHorizontal
} from 'lucide-react';

export default function MediaPage() {
  const { user } = useAuth();
  const { mediaConfig, config: collectionsConfig } = useCollections();
  const { selectedRepo } = useRepo();
  const source = useMemo(() => resolveMediaSource(mediaConfig, selectedRepo), [mediaConfig, selectedRepo]);
  // 命名模板：旧 {Y}{m} 语法在加载时一次性迁移为新 {{tag}} 语法（幂等）
  const migratedRenameTemplateRef = useRef(migrateLegacyTemplate(mediaConfig.renameTemplate));
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
  /**
   * 上传方式：默认取设置页配置；本次会话内切换不写回配置（避免一次误操作改变长期行为）。
   * 用户改设置页后 mediaConfig.uploadMode 变化，此处通过 key 重置（见下方 useEffect）。
   */
  const [uploadMode, setUploadMode] = useState<UploadMode>(mediaConfig.uploadMode);

  useEffect(() => {
    setUploadMode(mediaConfig.uploadMode);
  }, [mediaConfig.uploadMode]);

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

  /** S3 源判定（审查报告 M-A1）：分流上传/列表/删除/复制四个通道 */
  const isS3Source = mediaConfig.sourceType === 's3';
  const s3Config = mediaConfig.s3;
  const s3Prefix = useMemo(() => s3MediaPrefix(mediaConfig), [mediaConfig]);

  const loadFiles = useCallback(async (silent = false): Promise<MediaFile[] | null> => {
    // S3 走浏览器直连（凭据在本地配置），不依赖会话；GitHub 通道才需要登录态
    if (!isConfigured) return null;
    if (!isS3Source && !user) return null;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      let mediaFiles: MediaFile[];

      if (isS3Source && s3Config) {
        // S3 兼容图床：ListObjects 直连，外链走 publicBaseUrl
        const entries = await s3ListObjects(s3Config, s3Prefix);
        mediaFiles = entries
          .filter((e) => IMAGE_EXT_RE.test(e.key) || VIDEO_EXT_RE.test(e.key))
          .map((e) => ({
            name: e.key.split('/').pop() || e.key,
            path: e.key,
            sha: String(e.lastModified), // S3 无 blob sha：以 lastModified 作变更标识
            size: e.size,
            url: s3PublicUrl(s3Config, e.key) || '',
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
        isS3Source && s3Config ? s3PublicUrl(s3Config, path) : getCdnUrl(path)
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
      setError(err instanceof Error ? err.message : '媒体列表加载失败，请稍后重试');
      return null;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [user, isConfigured, source, getCdnUrl, isS3Source, s3Config, s3Prefix]);

  useEffect(() => {
    if (isConfigured) loadFiles();
  }, [isConfigured, loadFiles]);

  /**
   * 上传主流程：先为每个文件生成「计划」（格式/类型/模式/扩展名/上限），
   * 再按类型分组并发执行。决策与执行分离的原因见 lib/mediaUploadPlan.ts 顶部注释。
   */
  const handleUpload = async (fileList: FileList | File[]) => {
    if (!isConfigured) return;
    if (!isS3Source && !user) return;

    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) {
      setError('未选择任何文件');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    const errors: string[] = [];
    const notes: string[] = [];

    // 1. 计划阶段：所有拒绝都发生在这里，执行阶段不再做策略判断
    const plans: UploadPlan[] = [];
    for (const file of filesArray) {
      try {
        plans.push(await planUpload(file, uploadMode, { isS3: isS3Source }));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `${file.name}：无法处理`);
      }
    }

    if (plans.length === 0) {
      setError(errors.join('\n'));
      setUploading(false);
      return;
    }

    // 2. 执行阶段：图片并发 3、视频并发 1。
    //    视频独占带宽且 GitHub 端点对同文件并发写会 409；分组而非混排，
    //    避免大批图片把视频排到最后才动。
    let currentFiles = await loadFiles(true);
    const renameTemplate = migratedRenameTemplateRef.current;
    const dirPart = fillPathTemplate(source.pathPrefix);
    const login = user?.login ?? '';

    const uploadOne = async (plan: UploadPlan): Promise<boolean> => {
      const { file, kind, mode, ext } = plan;

      // 命名：模板 → 清洗（worker 路径白名单不允许空格）→ 拼扩展名
      const baseName = sanitizeMediaFileName(
        fillTemplate(renameTemplate, { filename: file.name })
      );
      const fileName = `${baseName}.${ext}`;
      const filePath = dirPart ? `${dirPart}/${fileName}` : fileName;

      // 重名判定必须比对完整路径：按月归档目录下 2026/09/a.webp 与 2026/10/a.webp 不是同一个文件
      const existing = currentFiles?.find((f) => f.path === filePath);
      if (existing && mediaConfig.duplicateStrategy === 'skip') {
        return false; // 由调用方计为 skipped
      }

      // 待上传字节：压缩模式做重编码，原图/视频直接用原始文件
      let payload: Blob = file;
      if (kind === 'image' && mode === 'compress') {
        const compressed = await compressImage(file, mediaConfig.quality);
        // 压缩无收益时回退原图：已优化的 AVIF / 小尺寸 PNG 转 WebP 常常更大，
        // 硬压会让「默认压缩」偶尔产生负效果
        if (compressed.size >= file.size * 0.98) {
          payload = file;
          notes.push(`${fileName}：压缩无收益，已保留原图`);
        } else {
          payload = compressed;
        }
      }

      if (isS3Source && s3Config) {
        // S3：Blob 直传（SigV4），大视频不经 Worker
        await s3PutObject(s3Config, filePath, payload);
      } else if (kind === 'video') {
        // 视频：走二进制端点，避免 base64 的 33% 膨胀与双份内存
        await uploadMediaBinary({
          owner: source.owner,
          repo: source.repo,
          path: filePath,
          blob: payload,
          message: `[skip ci] 上传：${fileName}`,
          branch: source.branch,
          userName: login,
          sha: existing?.sha
        });
      } else {
        // 图片：沿用 base64 端点（体积小，且该路径已有校验与回归覆盖）
        await uploadImage({
          owner: source.owner,
          repo: source.repo,
          path: filePath,
          base64Content: await blobToBase64(payload),
          message: `[skip ci] 上传：${fileName}`,
          branch: source.branch,
          userName: login,
          sha: existing?.sha
        });
      }

      // 派生资产（列表缩略图 / 视频封面）：失败不阻断主流程
      const derived = kind === 'video' ? await createVideoPoster(file) : await createThumbnail(file);
      if (derived) {
        try {
          const thumbPath = thumbnailPathFor(filePath);
          if (isS3Source && s3Config) {
            await s3PutObject(s3Config, thumbPath, derived);
          } else {
            await uploadImage({
              owner: source.owner,
              repo: source.repo,
              path: thumbPath,
              base64Content: await blobToBase64(derived),
              message: `[skip ci] 缩略图：${thumbPath.split('/').pop()}`,
              branch: source.branch,
              userName: login
            });
          }
        } catch {
          console.warn('[MediaPage] 缩略图/封面上传失败（不影响主文件）');
        }
      }

      if (currentFiles) {
        currentFiles = [{
          name: fileName,
          path: filePath,
          sha: existing?.sha || '',
          size: payload.size,
          lastModified: Date.now(),
          url: isS3Source && s3Config ? (s3PublicUrl(s3Config, filePath) || '') : getCdnUrl(filePath)
        }, ...currentFiles];
      }
      return true;
    };

    const runGroup = async (group: UploadPlan[], limit: number) => {
      let done = 0;
      await mapLimit(group, limit, async (plan) => {
        try {
          const ok = await uploadOne(plan);
          if (ok) done++;
        } catch (err) {
          errors.push(`${plan.file.name}：${err instanceof Error ? err.message : '上传失败，请稍后重试'}`);
        }
        return null;
      });
      return done;
    };

    const imagePlans = plans.filter((p) => p.kind === 'image');
    const videoPlans = plans.filter((p) => p.kind === 'video');
    const [imageDone, videoDone] = await Promise.all([
      runGroup(imagePlans, 3),
      runGroup(videoPlans, 1),
    ]);
    const uploaded = imageDone + videoDone;
    const skipped = plans.length - uploaded - errors.length;

    if (uploaded > 0) {
      setSuccess(`成功上传 ${uploaded} 个文件${skipped > 0 ? `，跳过 ${skipped} 个重名文件` : ''}`);
      await loadFiles();
    }
    if (notes.length > 0) {
      setSuccess((prev) => (prev ? `${prev}\n${notes.join('\n')}` : notes.join('\n')));
    }
    if (errors.length > 0) {
      // 多类型混合上传时拼接成一行不可读，改为换行分条
      setError(errors.join('\n'));
    }

    setUploading(false);
  };

  const handleDelete = (file: MediaFile) => {
    if (!user) return;
    setDeleteConfirm(file);
    setAssetReferences(null);
  };

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
      if (isS3Source && s3Config) {
        // S3 图床：直删对象（含同名缩略图/封面），无 commit
        await s3DeleteObject(s3Config, file.path);
        await s3DeleteObject(s3Config, thumbPath).catch(() => undefined);
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
      setSuccess(`已删除 ${file.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请稍后重试');
    }
  };

  const handleCopy = async (file: MediaFile) => {
    try {
      await navigator.clipboard.writeText(file.url);
      flashCopied(file.sha, 'url');
    } catch {
      setError('复制失败，请手动选中内容复制');
    }
  };

  const handleCopyMarkdown = async (file: MediaFile) => {
    // 视频没有 Markdown 原生语法，改复制 HTML5 嵌入片段
    const text = isVideoName(file.name)
      ? videoEmbedSnippet(file.url)
      : `![${file.name}](${file.url})`;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(file.sha, 'markdown');
    } catch {
      setError('复制失败，请手动选中内容复制');
    }
  };
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
      <header className="px-4 md:px-8 py-5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-medium text-foreground">媒体库</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {source.owner}/{source.repo} · {files.length} 个文件
            </p>
          </div>
          <div className="relative flex items-center gap-3">
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
      </header>

      <div className="flex-1 overflow-auto px-4 md:px-8 space-y-4">
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border border-destructive/25 rounded-sm text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="whitespace-pre-line flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} className="ml-auto flex-shrink-0" aria-label="关闭错误提示"><X className="w-3 h-3" /></button>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 px-3 py-2 bg-success/10 border border-success/25 rounded-sm text-xs text-success">
            <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="whitespace-pre-line flex-1">{success}</span>
            <button type="button" onClick={() => setSuccess('')} className="ml-auto flex-shrink-0" aria-label="关闭成功提示"><X className="w-3 h-3" /></button>
          </div>
        )}

        <MediaUploader
          uploading={uploading}
          quality={mediaConfig.quality}
          mode={uploadMode}
          onModeChange={setUploadMode}
          onUpload={handleUpload}
          videoLimitHint={isS3Source ? `≤ ${formatMegabytes(videoMaxBytes(true))}` : `GitHub 源 ≤ ${formatMegabytes(videoMaxBytes(false))}`}
        />

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            暂无文件。上传第一张图片或第一个视频即可开始使用
          </div>
        ) : (
          <>
            <div
              className="media-grid"
              style={{ '--pgrid': String(gridCols), '--mgrid': String(mobileCols) } as CSSProperties}
            >
            {files.slice(0, currentPage * MEDIA_PAGE_SIZE).map((file) => {
              const isVideo = isVideoName(file.name);
              const coverUrl = listImageUrlFor(file, repoFilePaths);
              return (
            <div
              key={file.path}
              className="group border border-border rounded-sm overflow-hidden hover:border-border transition-colors bg-card"
            >
                <div
                  className="relative aspect-square bg-accent flex items-center justify-center cursor-pointer overflow-hidden"
                  onClick={() => setPreviewFile(file)}
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
                    onClick={() => handleCopy(file)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-border rounded-sm hover:bg-accent transition-colors text-muted-foreground"
                    title="复制 URL"
                  >
                    {copiedId === file.sha && copiedType === 'url' ? (
                      <Check className="w-3 h-3 text-success" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyMarkdown(file)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-border rounded-sm hover:bg-accent transition-colors text-muted-foreground"
                    title={isVideo ? '复制嵌入代码' : '复制 Markdown 链接'}
                  >
                    {copiedId === file.sha && copiedType === 'markdown' ? (
                      <Check className="w-3 h-3 text-success" />
                    ) : (
                      <span className="text-[10px] font-bold">#</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(file)}
                    className="flex items-center justify-center px-2 py-1 border border-border rounded-sm hover:bg-destructive/10 hover:border-destructive/25 hover:text-destructive transition-colors text-muted-foreground"
                    title="删除"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
            {files.length > currentPage * MEDIA_PAGE_SIZE && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="px-6 py-2 text-sm bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
                >
                  加载更多，剩余 {files.length - currentPage * MEDIA_PAGE_SIZE} 个
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
    </div>
  );
}
