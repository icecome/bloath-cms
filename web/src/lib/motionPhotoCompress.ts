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
// 【提取/注入只在字节层操作，不解析 JPEG 全部段】按 marker 遍历，只认 APP1 中
// 三种承载 XMP 的载荷形态（标准 XMP / Exif 内嵌 / 扩展 XMP），比完整 JPEG 段
// 解析器小一个数量级，fail-closed：找不到就放弃压缩保留（调用方回退原图）。
// 2026-11-02 教训：旧实现只认「标准 XMP」一种形态，小米/OPPO/荣耀（Exif 内嵌）
// 与 >64KB 的扩展 XMP 全部 MISS，压缩分支被静默绕过，实际仍传 10~19MB 原图。

import { scaledImageSize } from './mediaUtils.ts';
import { MotionPhotoMergeError } from './motionPhotoMerge.ts';

/** JPEG SOI marker */
const JPEG_SOI = [0xff, 0xd8] as const;
/** JPEG APP1 marker */
const JPEG_APP1 = 0xe1;
/** 标准 XMP 命名空间前缀（段内容开头） */
const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
/** 扩展 XMP 命名空间前缀（>64KB 的 XMP 走分段承载） */
const XMP_EXT_NS = 'http://ns.adobe.com/xmp/extension/\0';
/** Exif 段标识（XMP 可能被厂商塞进 Exif APP1） */
const EXIF_NS = 'Exif\0\0';
/** 在段内容里定位 XMP 包起点的标签 */
const XMP_START_TAG = '<x:xmpmeta';

function startsWithBytes(buf: Uint8Array, at: number, pattern: Uint8Array): boolean {
  if (at + pattern.length > buf.length) return false;
  for (let i = 0; i < pattern.length; i++) if (buf[at + i] !== pattern[i]) return false;
  return true;
}

/** 在 [from, to) 区间内是否出现某字节序列 */
function containsBytes(buf: Uint8Array, from: number, to: number, pattern: Uint8Array): boolean {
  const end = Math.min(to, buf.length) - pattern.length;
  for (let i = from; i <= end; i++) {
    if (startsWithBytes(buf, i, pattern)) return true;
  }
  return false;
}

/**
 * 从 JPEG 字节中提取**含 XMP 包**的 APP1 段完整字节（FFE1 marker + 长度 + 内容）。
 *
 * 覆盖三种真实布局（实测 B/C 两种旧实现全 MISS，见 2026-11-02 超时诊断）：
 *   1. 独立 XMP APP1：段内容以 `http://ns.adobe.com/xap/1.0/\0` 开头（Adobe 标准）
 *   2. XMP 嵌在 Exif APP1：段内容以 `Exif\0\0` 开头，XMP 包在其后
 *      （小米/OPPO/荣耀等厂商工具链常见）
 *   3. 扩展 XMP：段内容以 `http://ns.adobe.com/xmp/extension/\0` 开头，
 *      XMP 超过 64KB 时按此分段承载
 *
 * 返回整段而非仅 XMP 包：回注时保持字节级一致，避免段结构被破坏。
 * fail-closed：找不到含 `<x:xmpmeta` 的 APP1 就返回 null，调用方回退原图。
 */
export function extractXmpApp1Segment(jpegBytes: Uint8Array): Uint8Array | null {
  if (jpegBytes[0] !== JPEG_SOI[0] || jpegBytes[1] !== JPEG_SOI[1]) {
    return null; // 不是 JPEG
  }

  const xmpNs = new TextEncoder().encode(XMP_NS);
  const xmpExtNs = new TextEncoder().encode(XMP_EXT_NS);
  const exifNs = new TextEncoder().encode(EXIF_NS);
  const xmpTag = new TextEncoder().encode(XMP_START_TAG);

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
      const contentStart = pos + 4;
      const isStandardXmp = startsWithBytes(jpegBytes, contentStart, xmpNs);
      const isExtXmp = startsWithBytes(jpegBytes, contentStart, xmpExtNs);
      // Exif 段必须真含 XMP 包才算（纯 Exif 段不能当 XMP 回注）
      const exifHasXmp = startsWithBytes(jpegBytes, contentStart, exifNs)
        && containsBytes(jpegBytes, contentStart, pos + 2 + segLen, xmpTag);

      if (isStandardXmp || isExtXmp || exifHasXmp) {
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
 * @throws MotionPhotoMergeError 输入不是 JPEG（无 SOI）或段自身结构非法时抛出，
 *         与 patchXmpStillLength / patchXmpVideoLength 异常类型统一（fail-closed）
 */
export function injectXmpApp1Segment(jpegBytes: Uint8Array, xmpSegment: Uint8Array): Uint8Array {
  if (jpegBytes[0] !== JPEG_SOI[0] || jpegBytes[1] !== JPEG_SOI[1]) {
    throw new MotionPhotoMergeError('注入目标不是 JPEG（缺少 SOI），放弃压缩保留');
  }
  // 段自身校验：FFE1 + 长度字段与字节数吻合，否则注入会破坏整个文件
  if (xmpSegment.length < 4 || xmpSegment[0] !== 0xff || xmpSegment[1] !== JPEG_APP1) {
    throw new MotionPhotoMergeError('待注入的不是合法 APP1 段，放弃压缩保留');
  }
  const declared = ((xmpSegment[2] ?? 0) << 8) | (xmpSegment[3] ?? 0);
  if (declared + 2 !== xmpSegment.length) {
    throw new MotionPhotoMergeError('APP1 段长度字段与字节数不符，放弃压缩保留');
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
  let finalMerged = injectXmpApp1Segment(compressed, xmpSegment);

  // 修补图像项 Item:Length（压缩后主图变小，旧声明会让读者越界）。
  // Length 位数变化会改变 XMP 段长 → 改变主图字节数 → 需迭代到不动点。
  // 迭代上限 3 次（长度通常 6~7 位，变化 ≤ 1 位即收敛）。
  const xmpContent = new TextDecoder('latin1').decode(xmpSegment.subarray(4));
  let seg = xmpSegment;
  for (let i = 0; i < 3; i++) {
    const patchedXmpBytes = encodeLatin1(patchXmpStillLength(xmpContent, finalMerged.length));
    // 重新打包 APP1 段（长度字段 + 内容）
    const rebuiltSeg = new Uint8Array(2 + 2 + patchedXmpBytes.length);
    rebuiltSeg[0] = 0xff;
    rebuiltSeg[1] = JPEG_APP1;
    const segLen = 2 + patchedXmpBytes.length;
    rebuiltSeg[2] = (segLen >> 8) & 0xff;
    rebuiltSeg[3] = segLen & 0xff;
    rebuiltSeg.set(patchedXmpBytes, 4);
    const merged = injectXmpApp1Segment(compressed, rebuiltSeg);
    // 不动点：重建段长度与上一轮一致 → 声明值与实际长度已自洽
    if (rebuiltSeg.length === seg.length) {
      finalMerged = merged;
      break;
    }
    seg = rebuiltSeg;
    finalMerged = merged;
  }
  return finalMerged;
}

/**
 * latin1 保真编码：字符码直接取低 8 位写回字节。
 *
 * 为什么不用 TextEncoder（UTF-8）：XMP 在文件里是 UTF-8，但本模块用 latin1
 * 读入以获得「字符下标 === 字节下标」的一一对应。若再按 UTF-8 编码回去，
 * 非 ASCII 的描述文本会被重新编码成不同字节数，破坏段结构与长度修补的准确性
 * （与 motionPhotoMerge.ts 的 encodeLatin1 同理）。
 */
function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * 修补 XMP 中**图像项**的 Item:Length（压缩后主图变小，旧声明会越界）。
 *
 * 与 patchXmpVideoLength（motionPhotoMerge.ts）同规则但目标相反：那边找 video/，
 * 这边找 image/。不修补的后果：读者按旧 Length 解析图像项 → 越界 → 成品不合法
 * （2026-11-02 实测：主图压到 1.2MB，XMP 仍声明 9MB）。
 *
 * @param xmp XMP 包文本（不含 APP1 段头，latin1 解码）
 * @param stillLength 压缩后主图的最终字节数
 * @returns 修补后的 XMP 文本
 * @throws MotionPhotoMergeError 找不到图像项（fail-closed，调用方回退原图）
 *
 * 异常类型与 patchXmpVideoLength 统一：两处都是「XMP Container 目录修补失败」，
 * 上层可按 `instanceof MotionPhotoMergeError` 一次性区分「可预期的不合规输入」
 * 与真正的程序缺陷（TypeError / RangeError 等），前者静默回退原图，后者应上报。
 */
export function patchXmpStillLength(xmp: string, stillLength: number): string {
  const itemTagRe = /<([A-Za-z_][\w.-]*:)?Item\b([^>]*?)\/?>/g;
  let patched = false;
  let out = xmp.replace(itemTagRe, (full, _pfx: string | undefined, attrs: string) => {
    if (!/(?:[A-Za-z_][\w.-]*:)?Mime\s*=\s*["']image\//i.test(attrs)) return full;
    patched = true;
    let next = attrs.replace(
      /((?:[A-Za-z_][\w.-]*:)?Length\s*=\s*["'])\d+(["'])/i,
      `$1${stillLength}$2`
    );
    if (!/(?:[A-Za-z_][\w.-]*:)?Length\s*=/i.test(next)) {
      next = next.replace(/\/?>$/, ` Item:Length="${stillLength}"$&`);
    }
    return full.replace(attrs, next);
  });

  if (!patched) {
    // 元素形式兜底：<X:Item ...><X:Mime>image/jpeg</X:Mime><X:Length>123</X:Length></X:Item>
    // 与 patchXmpVideoLength（motionPhotoMerge.ts:79-88）对齐：属性形式未命中时
    // 扫描元素嵌套形式，仅替换 image/ 项的 Length 子元素。
    const elemRe = /(<([A-Za-z_][\w.-]*:)?Item\b[^>]*>)([\s\S]*?)(<\/\2?Item>)/g;
    out = out.replace(elemRe, (full, open: string, _p2: string | undefined, inner: string, close: string) => {
      if (!/<(?:[A-Za-z_][\w.-]*:)?Mime\b[^>]*>\s*image\//i.test(inner)) return full;
      patched = true;
      const newInner = inner.replace(
        /(<(?:[A-Za-z_][\w.-]*:)?Length\b[^>]*>)\d+(<\/(?:[A-Za-z_][\w.-]*:)?Length>)/i,
        `$1${stillLength}$2`
      );
      return open + newInner + close;
    });
  }

  if (!patched) throw new MotionPhotoMergeError('XMP 中未找到图像项，无法修补主图长度');
  return out;
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
