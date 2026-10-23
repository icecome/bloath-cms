// 媒体库工具函数与常量

export const MEDIA_PAGE_SIZE = 40;
export const MAX_IMAGE_DIM = 4096;
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
/** 列表缩略图最长边（px） */
export const THUMBNAIL_DIM = 400;
/** 缩略图文件名前缀 */
export const THUMBNAIL_PREFIX = 'thumb-';

export interface MediaFile {
  name: string;
  path: string;
  sha: string;
  size?: number;
  url: string;
  lastModified: number;
}

/** 媒体类型：列表/选择器按此过滤（缩略图不参与） */
export type MediaKind = 'image' | 'video';

/**
 * 图片扩展名（媒体库 / 选择器共用）。
 * 与原先散落在 MediaPage 与 MediaPickerDialog 的两份字面量正则保持一致，
 * 集中到此处后新增格式只改一行。
 */
export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/**
 * 视频扩展名。
 * 只列浏览器 <video> 可直接播放的容器：mp4/m4v（H.264/AAC 主流）、webm、ogv。
 * mov 放行但 Chrome 常无法解码（Safari 可），mkv/avi/wmv 一律不接受（见 formatSniff）。
 */
export const VIDEO_EXT_RE = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;

/** 由文件名判定媒体类型；非媒体文件返回 null */
export function mediaKindOf(name: string): MediaKind | null {
  if (VIDEO_EXT_RE.test(name)) return 'video';
  if (IMAGE_EXT_RE.test(name)) return 'image';
  return null;
}

/** 是否视频文件 */
export function isVideoName(name: string): boolean {
  return VIDEO_EXT_RE.test(name);
}

/**
 * 嗅探格式 → 落盘扩展名。
 * 与 formatSniff 的 format 标识一一对应；未知格式返回 'bin'（调用方应在此之前拒绝）。
 */
const EXT_BY_FORMAT: Record<string, string> = {
  jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', avif: 'avif', svg: 'svg',
  mp4: 'mp4', m4v: 'm4v', webm: 'webm', ogv: 'ogv', ogg: 'ogg', mov: 'mov',
};

export function extForFormat(format: string): string {
  return EXT_BY_FORMAT[format] ?? 'bin';
}

/**
 * 清洗模板产出的文件名。
 *
 * 必要性：worker 的 isSafePathParam 使用 /^[a-zA-Z0-9\u4e00-\u9fff._/\-]+$/，
 * **不允许空格与多数标点**，而 fillTemplate 的 {{filename}} 直接取原文件名。
 * 结果：上传「my photo.jpg」会拼出含空格的路径 → worker 返回「path 或 branch 参数无效」，
 * 用户看到一条与文件名毫无关联的 400。视频文件名（录屏导出）带空格尤其常见。
 *
 * 注意：只清洗基名，扩展名由调用方单独拼接（避免二次清洗破坏 .webp 的点）。
 */
export function sanitizeMediaFileName(name: string): string {
  const cleaned = name
    .replace(/\.[^.]*$/, '')            // 去掉调用方可能带上的扩展名
    .replace(/\s+/g, '-')               // 空白 → 连字符
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || 'file';
}

/**
 * 视频嵌入片段。
 * Markdown 没有原生视频语法，`![]()` 对视频无效；Hugo shortcode 又绑定主题，
 * 因此用 HTML5 <video>——它在「Markdown 渲染器 + 静态站」两侧都成立。
 */
export function videoEmbedSnippet(url: string): string {
  return `<video controls preload="metadata" src="${url}" style="max-width:100%"></video>`;
}


/**
 * 是否为派生产物（列表缩略图 thumb-*）。
 * 这类文件由上传流程自动生成，不应作为独立条目出现在媒体列表或选择器里——
 * 但仍需出现在「路径存在性集合」中，供 listImageUrlFor 判定缩略图可用。
 */
export function isDerivedAsset(name: string): boolean {
  return name.startsWith(THUMBNAIL_PREFIX);
}

/**
 * 判断某文件是否有对应的列表缩略图（thumb-<name>.webp 同目录约定）。
 * 缩略图上传失败不阻断原图上传，列表端按存在性回退原图。
 */
export function thumbnailPathFor(path: string): string {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const name = path.split('/').pop() || path;
  return `${dir}${THUMBNAIL_PREFIX}${name.replace(/\.[^.]+$/, '')}.webp`;
}

/**
 * 列表展示用图片 URL。
 *
 * 三种情况：
 * 1. 视频：有 thumb- 封面就返回封面，没有返回空串——不能把视频 URL 塞进 <img>，
 *    那会触发一次无效的视频下载（体积可达数十 MB），UI 应改为渲染占位图标。
 * 2. SVG / 缩略图自身：直接用原 URL。
 * 3. 其它光栅图：有 thumb- 用缩略图，否则回退原图。
 */
export function listImageUrlFor(file: MediaFile, filesInRepo: Set<string>): string {
  if (isVideoName(file.name)) {
    const coverPath = thumbnailPathFor(file.path);
    return filesInRepo.has(coverPath) ? getCdnUrlForPath(coverPath, '') : '';
  }
  if (!/\.(png|jpe?g|webp|avif|bmp)$/i.test(file.name)) return file.url;
  if (file.name.startsWith(THUMBNAIL_PREFIX)) return file.url;
  const thumbPath = thumbnailPathFor(file.path);
  return filesInRepo.has(thumbPath) ? getCdnUrlForPath(thumbPath, file.url) : file.url;
}

/**
 * 由原图 URL 推导缩略图 URL：共享 CDN 前缀，替换末段路径。
 * CDN 模板形如 .../{owner}/{repo}@{branch}/{path}——直接替换最后一段不可靠，
 * 因此由调用方传入「按路径构造 URL」的函数更稳。
 */
let cdnUrlBuilder: ((path: string) => string) | null = null;

/** 注册路径→URL 构造器（MediaPage 挂载时注入，避免本模块反向依赖 React 上下文） */
export function registerCdnUrlBuilder(builder: (path: string) => string): void {
  cdnUrlBuilder = builder;
}

function getCdnUrlForPath(path: string, fallback: string): string {
  return cdnUrlBuilder ? cdnUrlBuilder(path) : fallback;
}

export function compressImage(file: File, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { naturalWidth: width, naturalHeight: height } = img;
      if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('当前浏览器不支持 Canvas，无法压缩图片'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('图片压缩失败，请更换图片后重试'));
        },
        'image/webp',
        quality / 100
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败，请确认文件未损坏'));
    };
    img.src = url;
  });
}

/**
 * 生成列表缩略图：最长边压到 THUMBNAIL_DIM，输出 webp。
 * 失败返回 null（缩略图属增强能力，不阻断上传主流程）。
 */
export async function createThumbnail(file: File): Promise<Blob | null> {
  try {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('load failed'));
      img.src = url;
    });
    await loaded;

    const scale = Math.min(1, THUMBNAIL_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return null;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.75);
    });
  } catch {
    return null;
  }
}

/**
 * 视频封面抽帧：取第 1 秒（短视频取中点，规避首帧黑屏），输出 webp。
 *
 * 与 createThumbnail 的关系：产物路径约定完全一致（thumb-<basename>.webp），
 * 因此列表渲染、删除清理、存在性判定三处逻辑无需为视频另写一套。
 *
 * 双超时是必需的：seeked 在部分编解码器/大文件下可能永不触发，
 * 没有超时会让整个上传卡在最后一步（封面属增强能力，失败必须能降级）。
 */
export async function createVideoPoster(file: File, dim = THUMBNAIL_DIM): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('metadata timeout')), 8000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('video load failed')); };
      video.src = url;
    });

    if (!video.videoWidth || !video.videoHeight) return null;

    const seekTo = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(1, video.duration / 2)
      : 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('seek timeout')), 5000);
      video.onseeked = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('seek failed')); };
      video.currentTime = seekTo;
    });

    const scale = Math.min(1, dim / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.8);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.substring(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('图片编码失败，请重新选择文件'));
    reader.readAsDataURL(blob);
  });
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  const Y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}-${m}-${day} ${h}:${min}:${s}`;
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
