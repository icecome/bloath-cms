// 媒体上传管线（从 MediaPage 抽出，供媒体库页与上传弹窗共用）。
//
// 抽取原因：上传入口从「页内常驻拖放区」改为「按钮 → 弹窗」后，
// 上传逻辑需要同时被 MediaPage（媒体库页）与 MediaUploadDialog（弹窗）使用，
// 且弹窗还要求「本次上传可临时改配置」。因此把「计划 → 执行 → 汇总」三段
// 管线整体搬到这里，配置项改为通过参数传入，不再从 context 里读死值。
//
// 并行媒体仓库（targetBackendId）：每次上传可指定目标后端仓库，
// 未指定则落默认仓库（mediaConfig.defaultBackendId）。目标后端的 kind 决定
// 数据通道：'s3' 走 Worker 代理（凭据在服务端），其余走 GitHub Trees/Contents API。
// 重名判定必须针对**目标后端**的文件列表（不能用当前浏览的仓库），
// 否则跨仓库上传会把同名文件误判为已存在。
//
// 行为保持不变：
//   · 决策与执行分离的原因见 lib/mediaUploadPlan.ts 顶部注释。
//   · 图片并发 3、视频并发 1（视频独占带宽，GitHub 端点对同文件并发写会 409）。
//   · Motion Photo（安卓动态照片）拆分路径、派生资产失败不阻断主流程。
import { useCallback, useState } from 'react';
import type { UploadMode } from '../../../shared/types';
import type { SelectedRepo } from '../../../shared/types';
import { uploadImage, uploadMediaBinary } from '../lib/api';
import { fillTemplate, fillPathTemplate, migrateLegacyTemplate } from '../lib/template';
import { s3PutObject, s3PublicUrl } from '../lib/s3MediaClient';
import { planUpload, type UploadPlan } from '../lib/mediaUploadPlan';
import {
  detectEmbeddedVideoCodec,
  isBrowserNativeCodec,
} from '../lib/motionPhoto';
import { transcodeMotionPhotoVideo, type TranscodeProgress } from '../lib/motionPhotoTranscode';
import { mapLimit } from '../lib/concurrency';
import { mediaCdnUrl } from '../lib/resolveMediaSource';
import { resolveBackendSource } from '../lib/mediaBackendResolve';
import {
  compressImage,
  blobToBase64,
  formatSize,
  createThumbnail,
  createVideoPoster,
  thumbnailPathFor,
  sanitizeMediaFileName,
  extForFormat,
  type MediaFile,
} from '../lib/mediaUtils';
import type { MediaConfig } from '../../../shared/types';

export interface MediaUploadParams {
  /** 媒体库配置（质量、重名策略、模板来源、并行仓库列表） */
  mediaConfig: MediaConfig;
  /** 当前选中的博客仓库（repo-dir / image-branch 后端定位用） */
  selectedRepo: SelectedRepo | null;
  /** 登录用户（GitHub 通道需要 login；S3 通道不需要） */
  login: string | null;
  /** 静默刷新当前浏览仓库的列表用（上传后刷新页面列表） */
  loadFiles: (silent?: boolean) => Promise<MediaFile[] | null>;
  /**
   * 列出指定后端的文件（重名判定用）。
   * 缺省时回退 loadFiles —— 仅在单仓库场景下等价；并行多仓库时必须提供，
   * 否则会把「当前浏览仓库」的文件列表误当作目标仓库的。
   */
  listFilesForBackend?: (backendId: string) => Promise<MediaFile[] | null>;
}

export interface MediaUploadResult {
  /**
   * 执行上传。返回成功上传的**文件集合**（不是计数）。
   * 计数不足以让调用方裁剪重试队列：管线对图片并发 3、视频并发 1 分组执行，
   * 成功顺序与传入顺序不一致，按计数裁剪会留下已成功的、移除已失败的。
   * 被拒绝/失败的文件名见 error。
   */
  upload: (
    files: FileList | File[],
    options: { mode: UploadMode; quality: number; renameTemplate: string; targetBackendId?: string }
  ) => Promise<Set<File>>;
  uploading: boolean;
  /** 失败信息（多行分条） */
  error: string;
  /** 成功信息（多行分条） */
  success: string;
  /** 转码组件加载提示（独立于 success/error，避免语义打架） */
  transcodeNotice: string | null;
  clearError: () => void;
  clearSuccess: () => void;
}

/**
 * 媒体上传管线。
 *
 * 与 MediaPage 原实现的关键差异：
 *   1. 模式/质量/重命名模板/目标后端由参数传入（支持弹窗内临时改配置），
 *      不再读取 context 中的固定值。
 *   2. 错误/成功信息由本 hook 持有并暴露，调用方决定如何展示。
 *   3. 并行仓库：目标后端的 kind 决定上传通道（见文件头注释）。
 */
export function useMediaUpload(params: MediaUploadParams): MediaUploadResult {
  const {
    mediaConfig, selectedRepo, login, loadFiles, listFilesForBackend,
  } = params;

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [transcodeNotice, setTranscodeNotice] = useState<string | null>(null);

  const upload = useCallback(
    async (
      fileList: FileList | File[],
      options: { mode: UploadMode; quality: number; renameTemplate: string; targetBackendId?: string }
    ): Promise<Set<File>> => {
      const { mode: uploadMode, quality, renameTemplate: rawTemplate } = options;

      // 模板每次上传都按调用方传入值解析（弹窗内可临时改模板，不能缓存首次结果）。
      // migrateLegacyTemplate 幂等：已是新语法时原样返回。
      const renameTemplate = migrateLegacyTemplate(rawTemplate);

      const filesArray = Array.from(fileList);
      if (filesArray.length === 0) {
        setError('未选择任何文件');
        return new Set();
      }

      // ---- 目标后端解析：未指定则用默认仓库 ----
      const backends = mediaConfig.backends || [];
      const targetBackendId = options.targetBackendId || mediaConfig.defaultBackendId;
      const backend =
        backends.find((b) => b.id === targetBackendId) ||
        backends.find((b) => b.id === mediaConfig.defaultBackendId) ||
        backends[0];
      if (!backend) {
        setError('请先在设置页配置媒体仓库');
        return new Set();
      }
      const isS3Source = backend.kind === 's3';
      const s3View = { publicBaseUrl: backend.s3PublicBaseUrl || '', backendId: backend.id };
      // GitHub 类后端的定位信息（owner/repo/branch/pathPrefix）：
      // 复用 mediaBackendResolve 的公共实现，避免与本文件外的解析逻辑分叉
      const source = resolveBackendSource(backend.kind, selectedRepo, {
        owner: backend.owner,
        repo: backend.repo,
        branch: backend.branch,
        pathPrefix: backend.pathPrefix,
      });
      /** 路径 → 外链 URL：S3 用 publicBaseUrl，其余用 CDN 模板 */
      const urlFor = (path: string): string =>
        isS3Source ? (s3PublicUrl(s3View, path) || '') : mediaCdnUrl(source, mediaConfig, path);

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
        return new Set();
      }

      // 2. 执行阶段：图片并发 3、视频并发 1
      // 重名判定针对**目标后端**的文件列表：并行仓库下当前浏览的仓库 ≠ 目标仓库
      let currentFiles = listFilesForBackend
        ? await listFilesForBackend(backend.id)
        : await loadFiles(true);
      const dirPart = fillPathTemplate(source.pathPrefix);
      const userName = login ?? '';

      const uploadOne = async (plan: UploadPlan): Promise<boolean> => {
        const { file, kind, mode } = plan;

        // 命名：模板 → 清洗（worker 路径白名单不允许空格）→ 拼扩展名
        const baseName = sanitizeMediaFileName(
          fillTemplate(renameTemplate, { filename: file.name })
        );
        // ext 可能被「压缩无收益回退原图」改写（.webp → 原格式），
        // 因此先算待上传字节，再用最终字节决定落盘扩展名，
        // 避免「.webp 路径里躺着 JPEG 字节」的错配
        let finalExt = plan.ext;
        const fileName = () => `${baseName}.${finalExt}`;
        const filePath = () => (dirPart ? `${dirPart}/${fileName()}` : fileName());

        // 重名判定必须比对完整路径：按月归档目录下 2026/09/a.webp 与 2026/10/a.webp 不是同一个文件
        const existing = currentFiles?.find((f) => f.path === filePath());
        if (existing && mediaConfig.duplicateStrategy === 'skip') {
          return false; // 由调用方计为 skipped
        }

        // ---- Motion Photo（安卓动态照片）特殊路径 ----
        if (plan.motionPhoto && plan.motionPhotoInfo) {
          const info = plan.motionPhotoInfo;
          const videoOffset = info.videoOffset ?? 0;
          const videoLength = info.videoLength ?? 0;

          // 1. 主图：Blob.slice 是视图，不复制字节（避免整文件进 JS 堆）
          const stillBlob = file.slice(0, videoOffset);
          let stillPayload: Blob = stillBlob;
          let stillExt = plan.ext;
          if (plan.mode === 'compress') {
            const compressed = await compressImage(
              new File([stillBlob], `${baseName}.jpg`, { type: 'image/jpeg' }),
              quality
            );
            // 压缩无收益时回退原图——此时扩展名必须跟着改
            if (compressed.size < stillBlob.size) {
              stillPayload = compressed;
            } else {
              stillExt = plan.format === 'heic' ? 'heic' : extForFormat(plan.format);
              notes.push(`${baseName}.${stillExt}：压缩无收益，已保留原图`);
            }
          }

          const stillFileName = `${baseName}.${stillExt}`;
          const stillPath = dirPart ? `${dirPart}/${stillFileName}` : stillFileName;
          const stillExisting = currentFiles?.find((f) => f.path === stillPath);

          // 2. 视频：剥离 → 判编码 → 切片直传或转码
          const videoBytes = new Uint8Array(
            await file.slice(videoOffset, videoOffset + videoLength).arrayBuffer()
          );
          let videoBlob: Blob | null = null;
          let videoNote = '';
          const codec = detectEmbeddedVideoCodec(videoBytes);
          if (isBrowserNativeCodec(codec)) {
            // H.264 内嵌：浏览器原生可播，零转码直接切片
            videoBlob = new Blob([videoBytes as BlobPart], { type: 'video/mp4' });
            videoNote = `动态视频已是 H.264，直接上传（${formatSize(videoBlob.size)}）`;
          } else {
            try {
              const result = await transcodeMotionPhotoVideo(videoBytes, {
                onProgress: (p: TranscodeProgress) => {
                  if (p.stage === 'loading') {
                    setTranscodeNotice('正在加载转码组件（首次约 31 MB，后续复用）……');
                  }
                },
              });
              videoBlob = result.blob;
              videoNote = `动态视频已转 H.264（${formatSize(videoBlob.size)}）`;
            } catch (err) {
              // 转码失败不阻断主图上传：博客里至少还有静态图
              console.warn('[useMediaUpload] Motion Photo 视频转码失败：', err);
              errors.push(`${file.name}：动态视频转码失败，已仅上传静态图`);
            }
          }

          // 3. 上传主图（与普通图片同路径）
          if (isS3Source) {
            await s3PutObject(s3View, stillPath, stillPayload);
          } else {
            await uploadImage({
              owner: source.owner,
              repo: source.repo,
              path: stillPath,
              base64Content: await blobToBase64(stillPayload),
              message: `[skip ci] 上传：${stillFileName}`,
              branch: source.branch,
              userName,
              sha: stillExisting?.sha,
            });
          }

          // 3.1 主图缩略图：动态照片的主图同样需要列表缩略图
          try {
            const thumb = await createThumbnail(
              new File([stillPayload], stillFileName, { type: stillPayload.type || 'image/jpeg' })
            );
            if (thumb) {
              const thumbPath = thumbnailPathFor(stillPath);
              if (isS3Source) {
                await s3PutObject(s3View, thumbPath, thumb);
              } else {
                await uploadImage({
                  owner: source.owner,
                  repo: source.repo,
                  path: thumbPath,
                  base64Content: await blobToBase64(thumb),
                  message: `[skip ci] 缩略图：${thumbPath.split('/').pop()}`,
                  branch: source.branch,
                  userName,
                });
              }
            }
          } catch {
            console.warn('[useMediaUpload] 动态照片主图缩略图上传失败（不影响主文件）');
          }

          // 4. 上传视频（同名 .mp4，与主图同目录）
          if (videoBlob) {
            const videoFileName = `${baseName}.mp4`;
            const videoPath = dirPart ? `${dirPart}/${videoFileName}` : videoFileName;
            const videoExisting = currentFiles?.find((f) => f.path === videoPath);
            if (videoExisting && mediaConfig.duplicateStrategy === 'skip') {
              notes.push(`${videoFileName}：已存在同名视频，按「跳过」策略未覆盖`);
            } else {
              if (isS3Source) {
                await s3PutObject(s3View, videoPath, videoBlob);
              } else {
                await uploadMediaBinary({
                  owner: source.owner,
                  repo: source.repo,
                  path: videoPath,
                  blob: videoBlob,
                  message: `[skip ci] 上传动态视频：${videoFileName}`,
                  branch: source.branch,
                  userName,
                  sha: videoExisting?.sha,
                });
              }
              notes.push(`${videoFileName}：${videoNote}`);
            }

            // 视频封面：取视频首帧
            try {
              const poster = await createVideoPoster(
                new File([videoBlob], videoFileName, { type: 'video/mp4' })
              );
              if (poster) {
                const posterPath = thumbnailPathFor(videoPath);
                if (isS3Source) {
                  await s3PutObject(s3View, posterPath, poster);
                } else {
                  await uploadImage({
                    owner: source.owner,
                    repo: source.repo,
                    path: posterPath,
                    base64Content: await blobToBase64(poster),
                    message: `[skip ci] 封面：${posterPath.split('/').pop()}`,
                    branch: source.branch,
                    userName,
                  });
                }
              }
            } catch {
              console.warn('[useMediaUpload] 动态视频封面上传失败（不影响主文件）');
            }
          }

          // 5. 更新本地列表缓存
          if (currentFiles) {
            currentFiles = [{
              name: stillFileName,
              path: stillPath,
              sha: stillExisting?.sha || '',
              size: stillPayload.size,
              lastModified: Date.now(),
              url: urlFor(stillPath),
            }, ...currentFiles];
            if (videoBlob) {
              const videoPath = dirPart ? `${dirPart}/${baseName}.mp4` : `${baseName}.mp4`;
              currentFiles = [{
                name: `${baseName}.mp4`,
                path: videoPath,
                sha: '',
                size: videoBlob.size,
                lastModified: Date.now(),
                url: urlFor(videoPath),
              }, ...currentFiles];
            }
          }
          setTranscodeNotice(null);
          return true;
        }

        // 待上传字节：压缩模式做重编码，原图/视频直接用原始文件
        let payload: Blob = file;
        if (kind === 'image' && mode === 'compress') {
          const compressed = await compressImage(file, quality);
          // 压缩无收益时回退原图：已优化的 AVIF / 小尺寸 PNG 转 WebP 常常更大
          if (compressed.size >= file.size * 0.98) {
            payload = file;
            finalExt = extForFormat(plan.format);
            notes.push(`${fileName()}：压缩无收益，已保留原图`);
          } else {
            payload = compressed;
          }
        }

        const resolvedFileName = fileName();
        const resolvedFilePath = filePath();

        if (isS3Source) {
          // S3：经 Worker 代理上传（SigV4），大视频不经 Worker
          await s3PutObject(s3View, resolvedFilePath, payload);
        } else if (kind === 'video') {
          // 视频：走二进制端点，避免 base64 的 33% 膨胀与双份内存
          await uploadMediaBinary({
            owner: source.owner,
            repo: source.repo,
            path: resolvedFilePath,
            blob: payload,
            message: `[skip ci] 上传：${resolvedFileName}`,
            branch: source.branch,
            userName,
            sha: existing?.sha,
          });
        } else {
          // 图片：沿用 base64 端点（体积小，且该路径已有校验与回归覆盖）
          await uploadImage({
            owner: source.owner,
            repo: source.repo,
            path: resolvedFilePath,
            base64Content: await blobToBase64(payload),
            message: `[skip ci] 上传：${resolvedFileName}`,
            branch: source.branch,
            userName,
            sha: existing?.sha,
          });
        }

        // 派生资产（列表缩略图 / 视频封面）：失败不阻断主流程
        const derived = kind === 'video' ? await createVideoPoster(file) : await createThumbnail(file);
        if (derived) {
          try {
            const thumbPath = thumbnailPathFor(resolvedFilePath);
            if (isS3Source) {
              await s3PutObject(s3View, thumbPath, derived);
            } else {
              await uploadImage({
                owner: source.owner,
                repo: source.repo,
                path: thumbPath,
                base64Content: await blobToBase64(derived),
                message: `[skip ci] 缩略图：${thumbPath.split('/').pop()}`,
                branch: source.branch,
                userName,
              });
            }
          } catch {
            console.warn('[useMediaUpload] 缩略图/封面上传失败（不影响主文件）');
          }
        }

        if (currentFiles) {
          currentFiles = [{
            name: resolvedFileName,
            path: resolvedFilePath,
            sha: existing?.sha || '',
            size: payload.size,
            lastModified: Date.now(),
            url: urlFor(resolvedFilePath),
          }, ...currentFiles];
        }
        return true;
      };

      /** 成功上传的文件集合：用于调用方按集合差集裁剪重试队列 */
      const succeeded = new Set<File>();

      const runGroup = async (group: UploadPlan[], limit: number) => {
        let done = 0;
        await mapLimit(group, limit, async (plan) => {
          try {
            const ok = await uploadOne(plan);
            if (ok) {
              done++;
              succeeded.add(plan.file);
            }
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
        // 刷新当前浏览仓库的列表（上传可能落在另一个后端，刷新当前视图即可，
        // 目标后端的列表由 listFilesForBackend 在下次上传时重新拉取）
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
      return succeeded;
    },
    [
      mediaConfig, selectedRepo, login, loadFiles, listFilesForBackend,
    ]
  );

  const clearError = useCallback(() => setError(''), []);
  const clearSuccess = useCallback(() => setSuccess(''), []);

  return {
    upload, uploading, error, success, transcodeNotice, clearError, clearSuccess,
  };
}
