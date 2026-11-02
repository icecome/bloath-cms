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
} from '../lib/motionPhoto';
import { transcodeMotionPhotoVideo, type TranscodeProgress } from '../lib/motionPhotoTranscode';
import {
  embeddedVideoStrategy,
} from '../lib/motionPhotoServerTranscode';
import { mergeMotionPhotoBytes, motionPhotoPath } from '../lib/motionPhotoMerge';
import { compressMotionStill } from '../lib/motionPhotoCompress';
import {
  buildMotionManifest,
  motionManifestName,
} from '../lib/motionPhotoManifest';
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
        // 单文件合成方案（docs/02-tech-designs/motion-photo-single-file-design-v2.md）：
        // 所有产物统一落 motion/ 子目录。三分支：
        //   native  → 浏览器纯 Blob 合成单文件 <base>.jpg（零 ffmpeg，即刻完成）
        //   server  → 写 <base>.src.jpg + <base>.src.mp4 + <base>.motion.json，
        //             图床 Actions 转码合成出 <base>.jpg 后删除源文件
        //   browser → S3 通道 wasm 转码，成功则合成单文件；失败降级成对输出
        if (plan.motionPhoto && plan.motionPhotoInfo) {
          const info = plan.motionPhotoInfo;
          const videoOffset = info.videoOffset ?? 0;
          const videoLength = info.videoLength ?? 0;

          // 落盘目录：媒体前缀 + motion/ 子目录（契约固定，见 motionPhotoMerge.MOTION_PHOTO_DIR）
          const motionDir = (p: string) => motionPhotoPath(dirPart, p);

          // 完整原始字节：server 路径需要写原始 .src.jpg（含旧视频尾巴），
          // 供图床 workflow 按 offset 截取主图合成（合成失败时完整源数据仍在仓库）。
          // 内存代价：把整文件读入 JS 堆（而非旧实现的 Blob.slice 视图）——合成
          // 必须操作完整字节，且动态照片受 planUpload 原图上限 IMAGE_ORIGINAL_MAX_BYTES
          // (14 MB) 约束，峰值内存可控，属有意取舍。
          let fullBytes = new Uint8Array(await file.arrayBuffer());

          // 视频字节：[videoOffset, videoOffset+videoLength)
          const videoBytes = new Uint8Array(
            await file.slice(videoOffset, videoOffset + videoLength).arrayBuffer()
          );

          // 压缩模式：压缩主图（保留 XMP APP1 + 视频字节）再合成，解决 10MB 上传超时。
          // compressMotionStill 输出「压缩后的 JPEG + 回注的原 XMP」，随后合成函数把
          // 视频拼回尾部——产物仍是合法单文件 Motion Photo。压缩无收益 / 非 JPEG /
          // XMP 缺失时抛错，回退原图（fullBytes 保持原样，与「压缩无收益回退原图」语义一致）。
          let compressedStillBytes: Uint8Array | null = null;
          if (plan.mode === 'compress' && plan.format === 'jpeg') {
            try {
              const still = fullBytes.subarray(0, videoOffset);
              const compressedStill = await compressMotionStill(still, quality);
              // 用压缩后的主图替换原主图区间，视频字节原样保留在尾部
              const recombined = new Uint8Array(compressedStill.length + videoBytes.length);
              recombined.set(compressedStill, 0);
              recombined.set(videoBytes, compressedStill.length);
              fullBytes = recombined;
              compressedStillBytes = compressedStill;
            } catch (err) {
              // 压缩失败/无收益/非 JPEG：静默回退原图（与普通图片「压缩无收益」对齐）
              console.warn('[useMediaUpload] 动态照片主图压缩回退原图：', err);
            }
          }

          const codec = detectEmbeddedVideoCodec(videoBytes);
          const strategy = embeddedVideoStrategy(codec, { isS3: isS3Source });

          // 合成用的视频起点：压缩后主图长度（未压缩时 === 原 videoOffset）。
          // 这是压缩路径最容易出错的地方——fullBytes 已是「压缩主图 + 视频」的拼装体，
          // 视频起点不再是原始 videoOffset。
          const mergeOffset = compressedStillBytes
            ? compressedStillBytes.length
            : videoOffset;

          // 单文件合成结果的落盘名（三分支共用）
          const outFileName = `${baseName}.jpg`;
          const outPath = motionDir(outFileName);
          const outExisting = currentFiles?.find((f) => f.path === outPath);
          if (outExisting && mediaConfig.duplicateStrategy === 'skip') {
            notes.push(`${outFileName}：已存在同名动态照片，按「跳过」策略未覆盖`);
            return false;
          }

          /** 上传合成后的单文件成品（含缩略图），并更新本地列表缓存 */
          const uploadMerged = async (merged: Uint8Array, note: string): Promise<boolean> => {
            const mergedBlob = new Blob([merged as BlobPart], { type: 'image/jpeg' });
            if (isS3Source) {
              await s3PutObject(s3View, outPath, mergedBlob);
            } else {
              // GitHub 通道走二进制端点（PUT /api/repos/media），不走 uploadImage 的 base64 JSON：
              // ① 10MB 合成成品 base64 后 13.3MB，受 uploadImage 固定 10s 超时必然超时
              //   （uploadImage 用 API_TIMEOUT_MS=10000；二进制端点按体积线性放大，
              //    10MB ≈ 50s）——实测超时问题的根因（2026-11-02）
              // ② 免 33% base64 膨胀与 JSON.stringify 双份内存拷贝
              // ③ Worker 侧 media 端点峰值内存更低（不进 JSON 解析器）
              await uploadMediaBinary({
                owner: source.owner,
                repo: source.repo,
                path: outPath,
                blob: mergedBlob,
                message: `[skip ci] 上传动态照片：${outFileName}`,
                branch: source.branch,
                userName,
                sha: outExisting?.sha,
              });
            }
            // 缩略图：与普通图片同约定（thumb- 前缀），失败不阻断
            try {
              const thumb = await createThumbnail(
                new File([mergedBlob], outFileName, { type: 'image/jpeg' })
              );
              if (thumb) {
                const thumbPath = thumbnailPathFor(outPath);
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
              console.warn('[useMediaUpload] 动态照片缩略图上传失败（不影响主文件）');
            }
            if (currentFiles) {
              currentFiles = [{
                name: outFileName,
                path: outPath,
                sha: outExisting?.sha || '',
                size: mergedBlob.size,
                lastModified: Date.now(),
                url: urlFor(outPath),
              }, ...currentFiles];
            }
            notes.push(`${outFileName}：${note}`);
            return true;
          };

          if (strategy === 'native') {
            // H.264 内嵌：浏览器纯 Blob 合成（截断尾部视频 → 原样拼回 → 修补 XMP）
            // 零 ffmpeg、零下载、零重编码；合成失败 fail-closed 抛错，交外层报错重试
            const merged = mergeMotionPhotoBytes(fullBytes, mergeOffset, videoBytes);
            return await uploadMerged(merged, `动态照片已合成单文件（H.264 内嵌，${formatSize(videoBytes.length)}）`);
          }

          if (strategy === 'server') {
            // GitHub 通道 + HEVC/AV1：原样上传双源 + 清单，由图床 Actions 合成。
            // 提交信息【必须】保留 server-transcode 标记——这是 workflow 的触发信号。
            // 顺序：src.jpg → src.mp4 → manifest（任一失败整组报错，workflow 幂等扫描可重试补齐）
            const srcStillPath = motionDir(`${baseName}.src.jpg`);
            const srcVideoPath = motionDir(`${baseName}.src.mp4`);
            const srcStillBlob = new Blob([fullBytes as BlobPart], { type: 'image/jpeg' });
            const srcVideoBlob = new Blob([videoBytes as BlobPart], { type: 'video/mp4' });

            await uploadMediaBinary({
              owner: source.owner,
              repo: source.repo,
              path: srcStillPath,
              blob: srcStillBlob,
              message: `[server-transcode] 动态照片源图：${baseName}.src.jpg`,
              branch: source.branch,
              userName,
              sha: currentFiles?.find((f) => f.path === srcStillPath)?.sha,
            });
            await uploadMediaBinary({
              owner: source.owner,
              repo: source.repo,
              path: srcVideoPath,
              blob: srcVideoBlob,
              message: `[server-transcode] 动态照片源视频：${baseName}.src.mp4`,
              branch: source.branch,
              userName,
              sha: currentFiles?.find((f) => f.path === srcVideoPath)?.sha,
            });

            const manifest = buildMotionManifest(baseName, {
              videoOffset: mergeOffset,
              videoLength,
            });
            const manifestBlob = new Blob(
              [JSON.stringify(manifest, null, 2)],
              { type: 'application/json' }
            );
            // 清单走二进制端点（与 .src 件同通道，语义一致；base64 图片端点语义不匹配）
            await uploadMediaBinary({
              owner: source.owner,
              repo: source.repo,
              path: motionDir(motionManifestName(baseName)),
              blob: manifestBlob,
              message: `[server-transcode] 动态照片合成指令：${baseName}.motion.json`,
              branch: source.branch,
              userName,
            });

            // 本地缓存注入三个中间态（真实列表刷新后由过滤规则剔除）
            if (currentFiles) {
              for (const [p, blob] of [
                [srcStillPath, srcStillBlob],
                [srcVideoPath, srcVideoBlob],
              ] as const) {
                currentFiles = [{
                  name: p.split('/').pop() || p,
                  path: p,
                  sha: '',
                  size: blob.size,
                  lastModified: Date.now(),
                  url: urlFor(p),
                }, ...currentFiles];
              }
            }
            notes.push(
              `${outFileName}：动态视频为 ${codec ?? '未知编码'}，已提交图床合成队列（约 1-2 分钟后可用）`
            );
            return true;
          }

          // S3 通道 + HEVC/AV1：浏览器 wasm 转码（尽力而为），成功即合成单文件
          try {
            const result = await transcodeMotionPhotoVideo(videoBytes, {
              onProgress: (p: TranscodeProgress) => {
                if (p.stage === 'loading') {
                  setTranscodeNotice('正在加载转码组件（首次约 31 MB，后续复用）……');
                }
              },
            });
            const merged = mergeMotionPhotoBytes(
              fullBytes,
              mergeOffset,
              new Uint8Array(await result.blob.arrayBuffer())
            );
            const ok = await uploadMerged(merged, `动态照片已合成单文件（wasm 转码 H.264，${formatSize(result.blob.size)}）`);
            setTranscodeNotice(null);
            return ok;
          } catch (err) {
            // 降级路径：转码失败但主图不丢（对齐「失败不阻断主图」哲学）。
            // 【修正 m-降级 2026-11-02】旧实现直接把截断主图存成 .jpg + 独立 .mp4，
            // 产出「图与视频分离」且 .jpg 的 XMP 还指向已被截断的旧视频——坏文件。
            // 现改为用合成函数把 videoBytes 原样内嵌回主图：输出仍是 motion/ 单文件
            // 规范（.jpg 内含视频），只是视频保留 HEVC 原样、未经 H.264 转码。
            // 不可播的浏览器看到的是静态主图（预览仍正常），可播的浏览器播放 HEVC。
            console.warn('[useMediaUpload] Motion Photo wasm 转码失败，降级为原样内嵌合成：', err);
            const fallbackMerged = mergeMotionPhotoBytes(fullBytes, mergeOffset, videoBytes);
            const ok = await uploadMerged(
              fallbackMerged,
              '浏览器转码失败，已按原样内嵌合成（部分浏览器可播 HEVC）'
            );
            setTranscodeNotice(null);
            return ok;
          }
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
