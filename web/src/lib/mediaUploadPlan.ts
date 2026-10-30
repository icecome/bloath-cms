// 上传计划层：把「格式判定 → 类型 → 模式 → 扩展名 → 上限」收成一个纯函数。
//
// 为什么要把决策与执行分开：改造前的 handleUpload 把三件事硬编码在一个循环里——
//   · 恒压缩（compressImage 是唯一路径）
//   · 扩展名硬编码 '.webp'
//   · 只接受 image/*（视频在 filter 阶段被无声丢弃）
// 视频接入后需要「不压缩、不 base64、扩展名随容器变」，三条都与原假设冲突。
// 集中到本模块后，执行层只按计划执行，不再做策略判断。
//
// 本模块是纯函数（不碰 DOM、不发请求），可直接单测。
import type { UploadMode } from '../../../shared/types';
import { sniffMedia } from './formatSniff.ts';
import { extForFormat } from './mediaUtils.ts';
import {
  IMAGE_MAX_SOURCE_BYTES,
  IMAGE_ORIGINAL_MAX_BYTES,
  videoMaxBytes,
  formatMegabytes,
} from './mediaLimits.ts';
import { parseMotionPhotoFile, type MotionPhotoInfo } from './motionPhoto.ts';

export type MediaKind = 'image' | 'video';

export interface UploadPlan {
  file: File;
  kind: MediaKind;
  /** 实际生效的模式（可能因格式或体积与用户选择不同） */
  mode: UploadMode;
  /** 落盘扩展名（不含点） */
  ext: string;
  /** 嗅探出的格式标识 */
  format: string;
  /** 模式被改写时的用户可读原因；null = 用户选择直接生效 */
  modeReason: string | null;
  /**
   * Motion Photo（安卓 Live Photo）标记。
   * 为 true 时执行层需做特殊处理：
   *   · kind === 'image'：该文件是「主图 + 内嵌 MP4」的单文件动态照片。
   *     执行层需剥离尾部视频，主图按 mode 处理，视频转码后作为独立文件上传。
   * 普通图片/视频为 false，走既有路径。
   */
  motionPhoto?: boolean;
  /** Motion Photo 解析详情（仅 motionPhoto === true 时有值） */
  motionPhotoInfo?: MotionPhotoInfo;
}

/** 计划阶段的拒绝：消息面向用户，可直接展示 */
export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejected';
  }
}

/** 不支持在浏览器 <video> 中播放的容器：给出可执行的替代建议，而不是干瘪的「格式错误」 */
const UNSUPPORTED_VIDEO: Record<string, string> = {
  matroska: 'MKV',
  avi: 'AVI',
};

/**
 * 判断文件是否可能是 Motion Photo（安卓动态照片）。
 *
 * 只对「静态图片容器」做此检查：Motion Photo 的主图是 JPEG / HEIC / AVIF，
 * 扩展名与普通图片完全一致，只有读 XMP 才能区分。
 * 视频文件不可能是 Motion Photo（那是主图侧的容器），直接跳过。
 *
 * ⚠ 关键：必须用 parseMotionPhotoFile(Blob) 而不是 parseMotionPhoto(切片)。
 * 后者用 bytes.length 当文件总长倒推偏移，只喂文件头时算出负数偏移 →
 * 检测永远失败。生产路径的真实形态就是 Blob（Web 标准 File/Blob），
 * 用 file.size 才是正确的总长。
 *
 * @param kind   调用方已嗅探出的类型（planUpload 会传，避免二次 sniff）
 * @param format 调用方已嗅探出的格式
 */
export async function detectMotionPhoto(
  file: Blob,
  kind: string,
  format: string
): Promise<MotionPhotoInfo | null> {
  // 视频不参与：Motion Photo 是「图片 + 内嵌视频」的单文件结构
  if (kind !== 'image') return null;
  // 静态图格式白名单：Motion Photo 规范只允许 JPEG / HEIC / AVIF 三种主图容器
  // （PNG/WebP 理论上也可以作为主图，但厂商实际都不用）
  if (!['jpeg', 'png', 'heic', 'avif', 'webp'].includes(format)) return null;

  const info = await parseMotionPhotoFile(file);
  return info.isMotionPhoto ? info : null;
}

/**
 * 上传前的唯一决策点。所有拒绝在此发生。
 *
 * @param requested 用户在界面上选择的模式
 * @param isS3 当前媒体源是否为 S3（决定视频上限）
 */
export async function planUpload(
  file: File,
  requested: UploadMode,
  opts: { isS3: boolean }
): Promise<UploadPlan> {
  const { kind, format } = await sniffMedia(file);

  if (format.startsWith('dangerous:')) {
    throw new UploadRejected(
      `「${file.name}」实际内容是 ${format.slice('dangerous:'.length)}，与媒体格式不符，已拒绝上传`
    );
  }
  if (kind === 'unknown') {
    throw new UploadRejected(`「${file.name}」无法识别为图片或视频，已拒绝上传`);
  }

  if (kind === 'video') {
    const unsupported = UNSUPPORTED_VIDEO[format];
    if (unsupported) {
      throw new UploadRejected(
        `「${file.name}」是 ${unsupported} 容器，浏览器无法直接播放，请先转为 MP4 或 WebM`
      );
    }

    const limit = videoMaxBytes(opts.isS3);
    if (file.size > limit) {
      throw new UploadRejected(
        `「${file.name}」（${formatMegabytes(file.size)}）超过视频上限 ${formatMegabytes(limit)}`
        + (opts.isS3 ? '' : '，大视频建议改用 S3 图床')
      );
    }

    // 普通视频恒为原样上传：浏览器端没有可靠的通用转码能力（见设计方案 §3.1）
    return {
      file,
      kind,
      mode: 'original',
      ext: extForFormat(format),
      format,
      modeReason: '视频不压缩，按原样上传',
    };
  }

  // ---- 图片 ----
  // GIF 压缩会丢动画（Canvas 只取首帧），SVG 光栅化是画质与体积双输：两者强制原图
  const forcedReason =
    format === 'gif' ? 'GIF 压缩会丢失动画，已按原图上传'
    : format === 'svg' ? 'SVG 为矢量格式，压缩会损失画质，已按原图上传'
    : null;

  let mode: UploadMode = forcedReason ? 'original' : requested;
  let modeReason = forcedReason;

  // ---- Motion Photo（安卓动态照片）：单文件，主图 + 内嵌 MP4 ----
  // 关键事实：Motion Photo 的主图扩展名就是 .jpg/.heic/.avif，与普通图片完全一样，
  // 只有读 XMP（Camera:MotionPhoto / GContainer:Directory）才能识别。
  //
  // 策略：
  //   · 主图部分按用户选择的模式处理（压缩 → WebP；原图 → 保留原格式）
  //   · 内嵌视频部分：H.264 → 直接切片上传；HEVC/AV1 → 转 H.264
  //   · HEIC/AVIF 主图浏览器无法解码 → 强制原图（Canvas 压缩会得到黑图）
  //
  // 注意：这里只做决策，不做剥离与转码（那是执行层的事）。
  const motionPhotoInfo = await detectMotionPhoto(file, kind, format);
  const isMotionPhoto = motionPhotoInfo !== null;

  if (isMotionPhoto && (format === 'heic' || format === 'avif')) {
    // HEIC/AVIF 主图：浏览器 <img> 不支持，Canvas drawImage 会得到空白
    mode = 'original';
    modeReason = '动态照片主图为 HEIC/AVIF，浏览器无法转码，已按原图上传（动态部分转 H.264）';
  }

  // 体积门槛按「剥离视频后的主图」算——动态照片的 file.size 含内嵌视频，
  // 用它做门槛会把 12MB 主图 + 3MB 视频的照片整条拒绝，而主图本身完全合规。
  const declaredStillBytes =
    isMotionPhoto && motionPhotoInfo.videoOffset !== null
      ? motionPhotoInfo.videoOffset
      : file.size;
  const limit = mode === 'original' ? IMAGE_ORIGINAL_MAX_BYTES : IMAGE_MAX_SOURCE_BYTES;
  if (declaredStillBytes > limit) {
    // 原图超限但压缩能过：自动降级而不是直接拒绝（用户目标是把图传上去）
    // HEIC/AVIF 主图不参与自动降级：浏览器无法在 Canvas 内压缩，超限只能拒绝
    if (!(isMotionPhoto && (format === 'heic' || format === 'avif')) &&
        mode === 'original' && declaredStillBytes <= IMAGE_MAX_SOURCE_BYTES) {
      mode = 'compress';
      modeReason = `原图超过 ${formatMegabytes(IMAGE_ORIGINAL_MAX_BYTES)}，已自动压缩`;
    } else {
      throw new UploadRejected(
        `「${file.name}」主图（${formatMegabytes(declaredStillBytes)}）超过上限 ${formatMegabytes(limit)}` +
        (isMotionPhoto ? '（动态照片按剥离视频后的主图体积判定）' : '')
      );
    }
  }

  return {
    file,
    kind,
    mode,
    ext: mode === 'compress' ? 'webp' : extForFormat(format),
    format,
    modeReason,
    motionPhoto: isMotionPhoto || undefined,
    motionPhotoInfo: motionPhotoInfo ?? undefined,
  };
}

/** 图片计划里哪些需要真正做重编码（原图模式直接读原始字节） */
export function shouldCompress(plan: UploadPlan): boolean {
  // Motion Photo 主图的「压缩」在执行层只针对剥离后的静态部分做，
  // 与普通图片同路径（Canvas 压缩），此处保持一致判定。
  return plan.kind === 'image' && plan.mode === 'compress';
}
