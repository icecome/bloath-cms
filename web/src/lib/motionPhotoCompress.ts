// 动态照片「压缩保留动态」压缩层。
//
// 【为什么存在】单文件合成方案下动态照片主图强制原图（14MB 上限），10MB 照片
// 上传慢且超时（见 2026-11-02 超时诊断）。Canvas 压缩能把主图压到 1-2MB，
// 但旧实现输出 WebP——WebP 容器没有 JPEG 的 APP1 段，XMP 与视频字节无处安放。
//
// 【本模块思路】Canvas 输出 JPEG（保留 JPEG 容器结构）→ 从原图提取 XMP APP1 段
// → 重新注入到压缩后 JPEG → 合成函数把视频拼回尾部。产物仍是合法单文件
// Motion Photo：压缩后的主图像素 + 原 XMP（含 Container 目录）+ 原 H.264/HEVC 视频。
//
// 【JPEG 段结构知识】（与 motionPhoto.ts 的 latin1 XMP 定位互补）
//   JPEG = SOI(FFD8) + 一串 marker 段 + 图像数据 + EOI(FFD9)
//   XMP 存于 APP1 段：FFE1 + 长度(2B 大端) + "http://ns.adobe.com/xap/1.0/\0" + XMP 包
//   注入位置：SOI 之后、任何其他段之前——标准无强制，紧随 SOI 最安全（不破坏
//   后续段顺序，Exif/ICC 等段在新文件里照旧）。
//
// 【提取/注入只在字节层操作，不解析 JPEG 全部段】只需找 FFE1 + Adobe XMP
// namespace 前缀这一种段（Motion Photo 的 XMP 一定在这里），比完整 JPEG 段
// 解析器小一个数量级，fail-closed：找不到就放弃压缩保留（调用方回退原图）。

import { scaledImageSize } from './mediaUtils.ts';

/** JPEG SOI marker */
const JPEG_SOI = [0xff, 0xd8] as const;
/** APP1 marker */
const JPEG_APP1 = 0xe1;
/** Adobe XMP namespace 的段头标识（XMP 专用 APP1 与 Exif APP1 的区别） */
const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * 从 JPEG 字节中提取 XMP APP1 段的完整字节（FFE1 marker + 长度 + 内容）。
 *
 * @returns APP1 段完整字节（含 FFE1 marker），找不到返回 null
 */
export function extractXmpApp1Segment(jpegBytes: Uint8Array): Uint8Array | null {
  if (jpegBytes[0] !== JPEG_SOI[0] || jpegBytes[1] !== JPEG_SOI[1]) {
    return null; // 不是 JPEG
  }
  // 从 SOI 之后扫描段；段结构：FF xx + [长度 2B 大端] + 内容
  let pos = 2;
  while (pos + 4 <= jpegBytes.length) {
    if (jpegBytes[pos] !== 0xff) return null; // 段结构损坏
    const marker = jpegBytes[pos + 1];
    if (marker === undefined) return null;
    // SOS（FFDA）之后是压缩图像数据，不再有段结构；XMP 必在 SOS 之前
    if (marker === 0xda) return null;
    // 填充字节 FF00 与连续 FF（部分编码器输出）跳过
    if (marker === 0x00 || marker === 0xff) {
      pos += 1;
      continue;
    }
    // 独立 marker（无长度字段）：D0-D9、RST 等
    if (marker >= 0xd0 && marker <= 0xd9) {
      pos += 2;
      continue;
    }
    const segLen = ((jpegBytes[pos + 2] ?? 0) << 8) | (jpegBytes[pos + 3] ?? 0);
    if (segLen < 2 || pos + 2 + segLen > jpegBytes.length) return null;
    if (marker === JPEG_APP1) {
      // 检查段内容前缀是否为 Adobe XMP namespace
      const contentStart = pos + 4;
      const nsBytes = Array.from(XMP_NS).map((c) => c.charCodeAt(0));
      let matched = true;
      for (let i = 0; i < nsBytes.length; i++) {
        if (jpegBytes[contentStart + i] !== nsBytes[i]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        // 返回整段（含 FFE1 marker + 长度 + 内容）
        return jpegBytes.slice(pos, pos + 2 + segLen);
      }
    }
    pos += 2 + segLen;
  }
  return null;
}

/**
 * 把 XMP APP1 段注入到 JPEG 字节紧随 SOI 之后。
 *
 * @param jpegBytes 压缩后的 JPEG（Canvas toBlob('image/jpeg') 输出）
 * @param xmpSegment extractXmpApp1Segment 返回的段字节
 * @returns 注入后的新 JPEG 字节
 * @throws 输入不是 JPEG（无 SOI）时抛错——fail-closed
 */
export function injectXmpApp1Segment(jpegBytes: Uint8Array, xmpSegment: Uint8Array): Uint8Array {
  if (jpegBytes[0] !== JPEG_SOI[0] || jpegBytes[1] !== JPEG_SOI[1]) {
    throw new Error('注入目标不是 JPEG（缺少 SOI），放弃压缩保留');
  }
  const out = new Uint8Array(jpegBytes.length + xmpSegment.length);
  out.set(jpegBytes.subarray(0, 2), 0);          // SOI
  out.set(xmpSegment, 2);                        // XMP APP1 紧随 SOI
  out.set(jpegBytes.subarray(2), 2 + xmpSegment.length); // 原其余字节
  return out;
}

/**
 * 压缩动态照片主图并保留 XMP：Canvas JPEG 压缩 + XMP APP1 回注。
 *
 * @param stillBytes 动态照片主图字节（[0, videoOffset)，须为 JPEG）
 * @param quality 1-100（与 compressImage 的 quality 语义一致）
 * @returns 压缩并回注 XMP 后的 JPEG 字节
 * @throws 非 JPEG / Canvas 不可用 / 压缩无收益（返回 ≥ 原体积）时抛错，
 *         调用方应回退原图（与 compressImage 的「压缩无收益」语义对齐）
 */
export async function compressMotionStill(
  stillBytes: Uint8Array,
  quality: number
): Promise<Uint8Array> {
  const xmpSegment = extractXmpApp1Segment(stillBytes);
  if (!xmpSegment) {
    throw new Error('主图无 XMP APP1 段（非 Motion Photo 主图？），放弃压缩保留');
  }

  // Canvas 压缩：DOM 依赖，不能进 node --test（与 compressImage 同约束）
  const blob = await drawToJpeg(stillBytes, quality);
  if (!blob) throw new Error('Canvas 压缩失败');
  const compressed = new Uint8Array(await blob.arrayBuffer());

  // 压缩无收益 → 回退原图（调用方语义对齐 compressImage）
  if (compressed.length >= stillBytes.length) {
    throw new Error('压缩无收益');
  }

  // 回注 XMP。注意：Canvas 输出的 JPEG 自带一个 JFIF APP0 段，紧随 SOI；
  // 注入后顺序变为 SOI + XMP(APP1) + JFIF(APP0) + ...，两者顺序无标准约束，
  // 读者按 marker 遍历不依赖顺序，安全。
  return injectXmpApp1Segment(compressed, xmpSegment);
}

/** Canvas 绘制并输出 JPEG Blob（DOM 依赖，单独抽出便于 mock） */
async function drawToJpeg(
  stillBytes: Uint8Array,
  quality: number
): Promise<Blob | null> {
  // 与 compressImage 相同的缩放逻辑：复用其尺寸约定
  const blob = new Blob([stillBytes as BlobPart], { type: 'image/jpeg' });
  const file = new File([blob], 'motion-still.jpg', { type: 'image/jpeg' });
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    // 与 compressImage 共用同一套降采样语义（MAX_IMAGE_DIM 长边上限），
    // 10MB 相机主图通常 4000x3000 → 降采样 + 质量压缩双重收益。
    const { width, height } = scaledImageSize(img.naturalWidth, img.naturalHeight);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.drawImage(img, 0, 0, width, height);
    const outBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality / 100)
    );
    return outBlob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
