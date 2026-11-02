// 动态照片单文件合成层（纯字节操作，零 DOM/网络依赖，可进 node --test）。
//
// 【职责】把「主图（截断到视频起点）+ 新视频」拼回单个 Motion Photo 文件，
// 并修补 XMP Container 目录中视频项的 Item:Length / Item:Padding，
// 使成品符合 Google Motion Photo Format 1.0（读者按「从尾算 Length」定位视频）。
//
// 设计方案见 docs/02-tech-designs/motion-photo-single-file-design-v2.md：
//   · 直传路径（内嵌视频已是 H.264）在浏览器端调用本模块零转码合成；
//   · 服务端路径（HEVC/AV1）由图床 workflow 的 merge_motion_photo.py 完成等价合成，
//     本模块同时是 Python 实现的算法参照与测试基准（两侧契约必须一致）。
//
// 【与解析层的契约】
//   · 视频定位信息来自 motionPhoto.ts 的 parseMotionPhotoFile（videoOffset/videoLength），
//     截断点 = videoOffset（主图字节 = [0, videoOffset)）；
//   · XMP 定位用 locateXmpPacket（latin1 下字符下标 === 字节下标）；
//   · 视频项修补目标与 findVideoItem 同规则：优先 Mime 为 video/ 的项，
//     找不到视频项时 **fail-closed 抛错**（宁可放弃合成也不产出坏文件）。
//
// 【为什么 Length 必须修补】转码后的视频字节数与原内嵌视频不同；
// 若沿用旧 XMP 声明，读者按旧长度从尾部倒推会截错起点、ftyp 校验失败，
// 动态部分被静默丢弃。Padding 修补为 0：我们拼接时不再引入厂商填充区。

import { locateXmpPacket, parseContainerItems, findVideoItem } from './motionPhoto.ts';

/** Motion Photo 成品的统一落盘目录（相对媒体根目录；两侧契约，勿单独修改） */
export const MOTION_PHOTO_DIR = 'motion';

/** 拼 motion/ 子目录路径（接受已有的前缀目录或空串） */
export function motionPhotoPath(prefix: string, fileName: string): string {
  return prefix ? `${prefix}/${MOTION_PHOTO_DIR}/${fileName}` : `${MOTION_PHOTO_DIR}/${fileName}`;
}

/** XMP 修补失败的异常：调用方应放弃合成（fail-closed），保留源文件等待重试 */
export class MotionPhotoMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionPhotoMergeError';
  }
}

/**
 * 修补 XMP 文本中视频项的 Item:Length / Item:Padding。
 *
 * 按「local name 匹配 + video/ Mime 过滤」定位，与前端 findVideoItem 同规则；
 * Ultra HDR 的 gainmap 项（image/*）不会被误改。
 *
 * @returns 修补后的 XMP 文本
 * @throws MotionPhotoMergeError 找不到视频项（fail-closed）
 */
export function patchXmpVideoLength(xmp: string, videoLength: number): string {
  const items = parseContainerItems(xmp);
  const videoItem = findVideoItem(items);
  if (!videoItem || videoItem.length === null) {
    throw new MotionPhotoMergeError('XMP Container 目录中未找到视频项，放弃合成');
  }

  // 逐个 Item 标签扫描：仅替换「声明了 video/ Mime」的 Item 的 Length/Padding 属性值。
  // 属性形式是厂商工具链的主流写法（元素形式见下方兜底）。
  const itemTagRe = /<([A-Za-z_][\w.-]*:)?Item\b([^>]*?)\/?>/g;
  let patched = false;
  let out = xmp.replace(itemTagRe, (full, _pfx: string | undefined, attrs: string) => {
    // Mime 判定与 findVideoItem 同规则：local name 匹配，不限前缀（Item:Mime / I:Mime 均可）
    if (!/(?:[A-Za-z_][\w.-]*:)?Mime\s*=\s*["']video\//i.test(attrs)) {
      return full;
    }
    patched = true;
    let next = attrs
      .replace(/((?:[A-Za-z_][\w.-]*:)?Length\s*=\s*["'])\d+(["'])/i, `$1${videoLength}$2`)
      .replace(/((?:[A-Za-z_][\w.-]*:)?Padding\s*=\s*["'])\d+(["'])/i, '$10$2');
    // Item 原本没有 Length 属性（异常输入）时补一个——标准要求视频项必须有 Length
    if (!/(?:[A-Za-z_][\w.-]*:)?Length\s*=/i.test(next)) {
      next = next.replace(/\/?>$/, ` Item:Length="${videoLength}"$&`);
    }
    return full.replace(attrs, next);
  });

  if (!patched) {
    // 元素形式兜底：<X:Item ...><X:Mime>video/mp4</X:Mime><X:Length>123</X:Length></X:Item>
    const elemRe = /(<([A-Za-z_][\w.-]*:)?Item\b[^>]*>)([\s\S]*?)(<\/\2?Item>)/g;
    out = out.replace(elemRe, (full, open: string, _p2: string | undefined, inner: string, close: string) => {
      if (!/<(?:[A-Za-z_][\w.-]*:)?Mime\b[^>]*>\s*video\//i.test(inner)) return full;
      patched = true;
      const newInner = inner
        .replace(/(<(?:[A-Za-z_][\w.-]*:)?Length\b[^>]*>)\d+(<\/(?:[A-Za-z_][\w.-]*:)?Length>)/i, `$1${videoLength}$2`)
        .replace(/(<(?:[A-Za-z_][\w.-]*:)?Padding\b[^>]*>)\d+(<\/(?:[A-Za-z_][\w.-]*:)?Padding>)/i, '$10$2');
      return open + newInner + close;
    });
  }

  if (!patched) {
    throw new MotionPhotoMergeError('XMP 视频项修补未命中（Mime 不含 video/），放弃合成');
  }
  return out;
}

/**
 * latin1 保真编码：字符码直接取低 8 位写回字节。
 *
 * 为什么不用 TextEncoder（UTF-8）：XMP 在文件里是 UTF-8，但本模块用 latin1
 * 读入以获得「字符下标 === 字节下标」的一一对应。若再按 UTF-8 编码回去，
 * 非 ASCII 的描述文本会被重新编码成不同字节数，破坏「修补前后主图区间」的一致性。
 * latin1 写回则保证除数字 Length 外所有字节逐一保持不变。
 */
function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * 合成单个 Motion Photo 文件。
 *
 * @param stillBytes  原始动态照片完整字节（含尾部旧视频）
 * @param videoOffset 原内嵌视频起始偏移（parseMotionPhotoFile 结果；主图 = [0, offset)）
 * @param newVideo    待内嵌的新视频字节（H.264；直传路径即原视频切片，服务端路径为转码产物）
 * @returns 成品字节（主图原字节 + 修补后的 XMP 区段 + 新视频）
 * @throws MotionPhotoMergeError 主图无 XMP / 无视频项 / offset 非法
 */
export function mergeMotionPhotoBytes(
  stillBytes: Uint8Array,
  videoOffset: number,
  newVideo: Uint8Array
): Uint8Array {
  if (!(videoOffset > 1024 && videoOffset < stillBytes.length)) {
    throw new MotionPhotoMergeError(`videoOffset 非法：${videoOffset}（总长 ${stillBytes.length}）`);
  }
  if (newVideo.length === 0) {
    throw new MotionPhotoMergeError('新视频为空，放弃合成');
  }

  const decoder = new TextDecoder('latin1');
  const text = decoder.decode(stillBytes.subarray(0, videoOffset));
  const span = locateXmpPacket(text);
  if (!span) {
    throw new MotionPhotoMergeError('主图字节中未找到 XMP 包，放弃合成');
  }
  // XMP 必须整体位于主图区间内（跨到旧视频区域说明定位错误）
  if (span.end > videoOffset) {
    throw new MotionPhotoMergeError('XMP 区间越过视频起点，定位异常，放弃合成');
  }

  const xmpText = text.slice(span.start, span.end);
  const patchedXmp = patchXmpVideoLength(xmpText, newVideo.length);
  const patchedBytes = encodeLatin1(patchedXmp);

  // 组装：[主图头][XMP 修补区段][主图其余部分][新视频]
  // 总长 = 主图区间（含修补差值 delta）+ 新视频。
  const delta = patchedBytes.length - (span.end - span.start);
  const total = videoOffset + delta + newVideo.length;
  const out = new Uint8Array(total);
  let pos = 0;
  out.set(stillBytes.subarray(0, span.start), pos); pos += span.start;
  out.set(patchedBytes, pos); pos += patchedBytes.length;
  out.set(stillBytes.subarray(span.end, videoOffset), pos); pos += videoOffset - span.end;
  out.set(newVideo, pos);
  return out;
}
