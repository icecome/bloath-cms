// 安卓动态照片（Google Motion Photo Format 1.0）解析层（纯逻辑，无 DOM 依赖）。
//
// 与 iPhone Live Photo 的本质区别：
//   · iPhone：双文件配对（IMG_xxxx.HEIC + IMG_xxxx.mov），靠 EXIF ContentIdentifier 关联
//   · 安卓（小米/努比亚/OPPO/荣耀等）：单文件内嵌（*.jpg / *.heic / *.avif），
//     尾部追加一段 MP4 视频，靠 XMP 元数据定位视频偏移量
//
// 标准出处：Google Motion Photo Format 1.0（android-developers.google.cn/motion-photo-format）
//   · 主图：JPEG / HEIC / AVIF（可带增益图 / Ultra HDR）
//   · 内嵌视频：MP4 容器，编码 H.264 / HEVC / AV1，含音轨
//   · 两组 XMP 元数据：
//       Camera 命名空间 http://ns.google.com/photos/1.0/camera/
//         Camera:MotionPhoto = 1（是否为动态照片）
//         Camera:MotionPhotoVersion = 1
//         Camera:MotionPhotoPresentationTimestampUs（静态图在视频中的时刻）
//         旧版 Camera:MicroVideoOffset（MicroVideo V1，已废弃但仍需兼容）
//       Container 命名空间 http://ns.google.com/photos/1.0/container/
//         GContainer:Directory → 若干 GContainer:Item
//         Item:Mime（image/… / video/mp4）、Item:Length（字节长度）、Item:Padding
//
// 【本模块的三条硬约束（均为踩坑换来的，勿改回去）】
// 1. 文件总长与「手里的这段字节」必须解耦。
//    倒推偏移用 `bytes.length - videoLength`，若只读到文件头 1MB，
//    bytes.length 变成 1MB，算出的偏移是负数 → 永远检测不到动态照片。
//    因此生产路径必须走 parseMotionPhotoFile(Blob)，它用 file.size（真实总长）。
// 2. XMP 的「前缀」是绑定，不是字段名。
//    `<Container:Item Item:Length>` 与 `<I:Item I:Length>` 语义相同，
//    前缀由文档自行声明 namespace，不同厂商工具链生成的前缀不保证一致。
//    本模块一律按「namespace URI + local name」解析，不写死前缀。
// 3. 视频项必须按 Item:Mime="video/…" 定位，不能按出现顺序取第 N 项。
//    Ultra HDR 的目录是 image / gainmap / video 三项，顺序取会拿到增益图长度。

/** Camera 命名空间 URI */
export const CAMERA_NS = 'http://ns.google.com/photos/1.0/camera/';
/** Container 命名空间 URI */
export const CONTAINER_NS = 'http://ns.google.com/photos/1.0/container/';

/**
 * 输出视频的扩展名（MP4 容器：浏览器 <video> 标准可播容器）。
 */
export const MOTION_PHOTO_VIDEO_EXT = 'mp4';

/** MP4 的 ftyp 魔数 */
const FTYP = [0x66, 0x74, 0x79, 0x70] as const;

/** Motion Photo 解析结果 */
export interface MotionPhotoInfo {
  /** 是否为 Motion Photo（视频确实存在且偏移可信） */
  isMotionPhoto: boolean;
  /** 内嵌视频字节起始偏移（相对文件开头）；null = 未找到视频 */
  videoOffset: number | null;
  /** 内嵌视频字节长度 */
  videoLength: number | null;
  /** XMP 声明的 MotionPhotoVersion */
  version: number | null;
  /** 检测到的旧版 MicroVideoOffset（仅兼容读取，新标准已废弃） */
  legacyMicroVideoOffset: number | null;
}

/** XMP 声明解析结果（不依赖文件总长，可独立单测） */
export interface MotionPhotoHeader {
  /** Camera:MotionPhoto 的值：1 = 是；0/负 = 显式否定；null = 未声明 */
  motionPhotoFlag: number | null;
  version: number | null;
  /** Container 目录中视频项声明的长度（字节） */
  declaredVideoLength: number | null;
  /** Container 目录中视频项声明的 padding（字节） */
  declaredVideoPadding: number | null;
  /** 旧版 MicroVideoOffset（从文件尾算） */
  legacyMicroVideoOffset: number | null;
}

// ---------------------------------------------------------------------------
// XMP 基础提取
// ---------------------------------------------------------------------------

/**
 * 从字节数组中提取 XMP 包（<x:xmpmeta ...> ... </x:xmpmeta>）。
 *
 * JPEG：APP1 段（FFE1）。HEIC/AVIF：meta box 内的 XML。
 * 两者统一直接搜索字节流中的标签，取之间的文本——最宽松且不依赖容器解析。
 *
 * 用 latin1 解码保证「字节 ↔ 字符」1:1 不丢字节（XMP 实际是 UTF-8，
 * 但 latin1 读出的字节序与原文一致，用 indexOf 搜 ASCII 标签是安全的；
 * 真正按 UTF-8 解码的是后面 XML 片段的部分）。
 */
export function extractXmpPacket(bytes: Uint8Array): string | null {
  const decoder = new TextDecoder('latin1');
  const text = decoder.decode(bytes);

  const startTag = '<x:xmpmeta';
  const endTag = '</x:xmpmeta>';
  const start = text.indexOf(startTag);
  if (start < 0) return null;
  const end = text.indexOf(endTag, start);
  if (end < 0) return null;

  return text.slice(start, end + endTag.length);
}

/**
 * 收集 XMP 中声明的 namespace 前缀：prefix → URI。
 * 形如 xmlns:PREFIX="URI" 或 xmlns:PREFIX='URI'。
 */
export function parseNamespacePrefixes(xmp: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmp)) !== null) {
    if (m[1] && m[2]) map.set(m[1], m[2]);
  }
  return map;
}

/**
 * 找出指向指定 namespace URI 的所有前缀。
 * 若某个前缀都没声明（例如厂商生成了非标准 URI），返回空数组——
 * 调用方应退回「local name 匹配」策略。
 */
export function prefixesForNamespace(xmp: string, namespaceUri: string): string[] {
  const map = parseNamespacePrefixes(xmp);
  const out: string[] = [];
  for (const [prefix, uri] of map) {
    if (uri === namespaceUri) out.push(prefix);
  }
  return out;
}

/**
 * 按「前缀 + local name」提取属性值或元素文本。
 *
 * @param xmp         XMP 全文
 * @param prefixes    允许的前缀集合（空集合 = 不限前缀，只按 local name 匹配）
 * @param localName   字段的 local name（如 MotionPhoto / Length / Mime）
 * @param numeric     true 时只返回能解析为整数的值
 */
function extractNamespacedValue(
  xmp: string,
  prefixes: string[],
  localName: string,
  numeric: boolean
): string | null {
  const quoted = prefixes.map((p) => `${p}:${localName}`).join('|');
  // 空前缀集合 → 用通用前缀通配（[\w.-]+:）
  const namePattern = quoted.length > 0
    ? quoted
    : `(?:[A-Za-z_][\\w.-]*:)?${localName}`;

  // 1. 元素形式：<PFX:LocalName attr="...">value</PFX:LocalName>
  const elemRe = new RegExp(`<(?:${namePattern})\\b[^>]*>([^<]*)<`, 'i');
  const em = xmp.match(elemRe);
  if (em && em[1] !== undefined) {
    const v = em[1].trim();
    if (numeric && !/^-?\d+$/.test(v)) return null;
    if (v) return v;
  }

  // 2. 属性形式：PFX:LocalName="value"
  const attrRe = new RegExp(`(?:${namePattern})\\s*=\\s*["']([^"']*)["']`, 'i');
  const am = xmp.match(attrRe);
  if (am && am[1] !== undefined) {
    const v = am[1].trim();
    if (numeric && !/^-?\d+$/.test(v)) return null;
    if (v) return v;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 各字段解析（全部 namespace-aware）
// ---------------------------------------------------------------------------

/** 解析 Camera:MotionPhoto（1 = 是，0/负 = 显式否定，null = 未声明） */
export function parseMotionPhotoFlag(xmp: string): number | null {
  const prefixes = prefixesForNamespace(xmp, CAMERA_NS);
  const v = extractNamespacedValue(xmp, prefixes, 'MotionPhoto', true);
  return v === null ? null : parseInt(v, 10);
}

/** 解析 Camera:MotionPhotoVersion */
export function parseMotionPhotoVersion(xmp: string): number | null {
  const prefixes = prefixesForNamespace(xmp, CAMERA_NS);
  const v = extractNamespacedValue(xmp, prefixes, 'MotionPhotoVersion', true);
  return v === null ? null : parseInt(v, 10);
}

/** 解析旧版 Camera:MicroVideoOffset（从文件尾算的字节偏移） */
export function parseMicroVideoOffset(xmp: string): number | null {
  const prefixes = prefixesForNamespace(xmp, CAMERA_NS);
  const v = extractNamespacedValue(xmp, prefixes, 'MicroVideoOffset', true);
  return v === null ? null : parseInt(v, 10);
}

/** Container 目录中的一个条目 */
export interface ContainerItem {
  /** Item:Mime，如 image/jpeg、video/mp4 */
  mime: string | null;
  /** Item:Length（字节） */
  length: number | null;
  /** Item:Padding（字节）：视频实际起点需再减去 padding */
  padding: number | null;
}

/**
 * 解析 Container:Directory 下的所有 Item。
 *
 * 按 local name 匹配（不写死前缀），因此 `Item:` / `I:` / `Container:` 都能解析。
 * 属性与元素两种写法都支持。
 */
export function parseContainerItems(xmp: string): ContainerItem[] {
  const items: ContainerItem[] = [];

  // 匹配 <X:Item ...> 或 <X:Item .../>
  const tagRe = /<([A-Za-z_][\w.-]*:)?Item\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xmp)) !== null) {
    const attrs = m[2] ?? '';

    const mime =
      matchLocal(attrs, 'Mime') ??
      matchLocal(attrs, 'ContentType');

    const lenRaw = matchLocal(attrs, 'Length');
    const padRaw = matchLocal(attrs, 'Padding');

    items.push({
      mime: mime ?? null,
      length: lenRaw !== null && /^\d+$/.test(lenRaw) ? parseInt(lenRaw, 10) : null,
      padding: padRaw !== null && /^\d+$/.test(padRaw) ? parseInt(padRaw, 10) : null,
    });
  }

  // 元素形式兜底：<X:Length>123</X:Length> 写在 Item 元素内部
  if (items.length > 0) {
    const elemRe = /<([A-Za-z_][\w.-]*:)?Item\b([^>]*)>([\s\S]*?)<\/\1?Item>/g;
    let em: RegExpExecArray | null;
    while ((em = elemRe.exec(xmp)) !== null) {
      const inner = em[3] ?? '';
      const idx = items.findIndex((it) => it.length === null && it.mime === null);
      if (idx < 0) continue;
      const target = items[idx];
      if (!target) continue;
      const lenRaw = matchLocal(inner, 'Length');
      const mimeRaw = matchLocal(inner, 'Mime');
      if (lenRaw && /^\d+$/.test(lenRaw)) target.length = parseInt(lenRaw, 10);
      if (mimeRaw) target.mime = mimeRaw;
    }
  }

  return items;
}

/**
 * 从属性串/元素文本里按 local name 取值（忽略前缀）。
 * 支持 name="v" 与 <name>v</name> 两种形式。
 */
function matchLocal(source: string, localName: string): string | null {
  const attrRe = new RegExp(`(?:[A-Za-z_][\\w.-]*:)?${localName}\\s*=\\s*["']([^"']*)["']`, 'i');
  const am = source.match(attrRe);
  if (am && am[1] !== undefined) return am[1].trim();

  const elemRe = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b[^>]*>([^<]*)<`, 'i');
  const em = source.match(elemRe);
  if (em && em[1] !== undefined) return em[1].trim();

  return null;
}

/**
 * 从 Container 目录中定位**视频项**。
 *
 * 优先按 Item:Mime="video/…" 精确匹配（规范要求，也是 Ultra HDR 三项目录下
 * 唯一正确的定位方式）。找不到 Mime 时退回「最后一个带长度的项」——
 * 规范规定目录按容器内文件顺序排列，视频总是最后一个。
 */
export function findVideoItem(items: ContainerItem[]): ContainerItem | null {
  if (items.length === 0) return null;

  const byMime = items.find((it) => it.mime && it.mime.toLowerCase().startsWith('video/'));
  if (byMime) return byMime;

  const withLength = items.filter((it) => it.length !== null);
  if (withLength.length === 0) return null;
  return withLength[withLength.length - 1] ?? null;
}

/**
 * 解析 Container 目录中视频项的长度（字节）。
 * @deprecated 保留给旧调用点；新代码请用 findVideoItem 以同时拿到 padding
 */
export function parseContainerVideoLength(xmp: string): number | null {
  const item = findVideoItem(parseContainerItems(xmp));
  return item?.length ?? null;
}

/**
 * 只解 XMP 声明，不校验视频是否真实存在（不依赖文件总长）。
 * 分离出来的意义：这两件事的依赖不同，混在一起会导致「用切片长度当总长」的 bug。
 */
export function parseMotionPhotoHeader(head: Uint8Array): MotionPhotoHeader {
  const empty: MotionPhotoHeader = {
    motionPhotoFlag: null,
    version: null,
    declaredVideoLength: null,
    declaredVideoPadding: null,
    legacyMicroVideoOffset: null,
  };

  const xmp = extractXmpPacket(head);
  if (!xmp) return empty;

  const videoItem = findVideoItem(parseContainerItems(xmp));

  return {
    motionPhotoFlag: parseMotionPhotoFlag(xmp),
    version: parseMotionPhotoVersion(xmp),
    declaredVideoLength: videoItem?.length ?? null,
    declaredVideoPadding: videoItem?.padding ?? null,
    legacyMicroVideoOffset: parseMicroVideoOffset(xmp),
  };
}

// ---------------------------------------------------------------------------
// 尾部扫描与 codec 探测
// ---------------------------------------------------------------------------

/**
 * 兜底：在字节尾部扫描 MP4 的 ftyp box 头（'ftyp' 位于 box 的 offset 4..8）。
 * 用于 XMP 元数据被剥离但视频数据仍在的场景（社交平台常这样）。
 *
 * @returns 视频起始偏移（相对传入字节数组的开头），未找到返回 null
 */
export function scanTrailingMp4Offset(bytes: Uint8Array): number | null {
  for (let i = 0; i + 8 < bytes.length; i += 4) {
    // ftyp box 头必在 4 字节对齐处
    if (
      bytes[i + 4] === FTYP[0] && bytes[i + 5] === FTYP[1] &&
      bytes[i + 6] === FTYP[2] && bytes[i + 7] === FTYP[3]
    ) {
      return i;
    }
  }
  return null;
}

/**
 * 从内嵌 MP4 的 stsd box 探测视频编码 fourcc。
 *
 * 用途：判断能否走「直接切片上传」的零转码快路径。
 *   · avc1 / avc3 → H.264，浏览器原生可播，**不需要 ffmpeg**
 *   · hev1 / hvc1 → HEVC，桌面 Chrome/Firefox 多不支持，需要转码
 *   · av01 → AV1，同上
 *
 * stsd 结构：'stsd'(4) + version/flags(4) + entry_count(4) → sample entry:
 * size(4) + fourcc(4)。因此 fourcc 位于 'stsd' 之后 12 字节处。
 */
export function detectEmbeddedVideoCodec(bytes: Uint8Array): string | null {
  for (let i = 0; i + 20 < bytes.length; i++) {
    if (
      bytes[i] === 0x73 && bytes[i + 1] === 0x74 &&
      bytes[i + 2] === 0x73 && bytes[i + 3] === 0x64 // 'stsd'
    ) {
      // stsd + 4(version/flags) + 4(entry_count) + 4(sample entry size) → fourcc
      const b16 = bytes[i + 16];
      const b17 = bytes[i + 17];
      const b18 = bytes[i + 18];
      const b19 = bytes[i + 19];
      if (b16 === undefined || b17 === undefined || b18 === undefined || b19 === undefined) {
        continue;
      }
      const fourcc = String.fromCharCode(b16, b17, b18, b19);
      if (/^[a-zA-Z0-9]{4}$/.test(fourcc)) return fourcc;
    }
  }
  return null;
}

/** 该 fourcc 是否为浏览器可原生解码（可走零转码快路径） */
export function isBrowserNativeCodec(fourcc: string | null): boolean {
  return fourcc === 'avc1' || fourcc === 'avc3';
}

// ---------------------------------------------------------------------------
// 核心：定位内嵌视频
// ---------------------------------------------------------------------------

/** 定位结果 */
interface VideoLocation {
  offset: number | null;
  length: number | null;
}

/**
 * 在**完整字节**中定位内嵌视频（bytes.length 即文件总长）。
 *
 * @param bytes 完整文件字节（不是切片）
 */
export function locateVideoInFullBytes(bytes: Uint8Array): VideoLocation {
  const total = bytes.length;
  const header = parseMotionPhotoHeader(bytes.subarray(0, Math.min(total, 256 * 1024)));

  // 显式否定优先：标准规定 MotionPhoto=0 或负值时「必须视为非动态照片，
  // 即使文件中确实追加了视频」。此时不做任何兜底扫描。
  if (header.motionPhotoFlag !== null && header.motionPhotoFlag <= 0) {
    return { offset: null, length: null };
  }

  const hasFtypAt = (offset: number): boolean =>
    offset > 1024 && offset + 8 <= total &&
    bytes[offset + 4] === FTYP[0] && bytes[offset + 5] === FTYP[1] &&
    bytes[offset + 6] === FTYP[2] && bytes[offset + 7] === FTYP[3];

  // ① 新标准：Item:Length（从尾算）+ Item:Padding
  const declared = header.declaredVideoLength;
  if (declared !== null && declared > 0 && declared + (header.declaredVideoPadding ?? 0) < total) {
    const offset = total - declared - (header.declaredVideoPadding ?? 0);
    if (hasFtypAt(offset)) return { offset, length: declared };
  }

  // ② 旧标准：MicroVideoOffset（从尾算）
  const legacy = header.legacyMicroVideoOffset;
  if (legacy !== null && legacy > 0 && legacy < total) {
    const offset = total - legacy;
    if (hasFtypAt(offset)) return { offset, length: legacy };
  }

  // ③ 兜底：扫尾部找 ftyp。标准明确要求读者「必须始终确认视频存在」，
  //    魔数比 XMP 标志更可信——XMP 长度可能已被编辑器改坏。
  const window = Math.min(total, 32 * 1024 * 1024);
  const tail = bytes.subarray(total - window);
  const rel = scanTrailingMp4Offset(tail);
  if (rel === null) return { offset: null, length: null };
  const offset = total - window + rel;
  if (offset <= 1024 || offset >= total - 8) return { offset: null, length: null };
  return { offset, length: total - offset };
}

/**
 * 解析完整字节中的 Motion Photo（仅供测试与「文件已在内存」的场合）。
 * 生产路径请用 parseMotionPhotoFile(Blob)，它不要求全文件驻留内存。
 */
export function parseMotionPhoto(bytes: Uint8Array): MotionPhotoInfo {
  const header = parseMotionPhotoHeader(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
  const loc = locateVideoInFullBytes(bytes);
  return {
    isMotionPhoto: loc.offset !== null,
    videoOffset: loc.offset,
    videoLength: loc.length,
    version: header.version,
    legacyMicroVideoOffset: header.legacyMicroVideoOffset,
  };
}

/**
 * 从 File/Blob 解析 Motion Photo —— **生产路径**。
 *
 * 与 parseMotionPhoto 的关键区别：用 file.size（真实总长）倒推偏移，
 * 只读「文件头」与「文件尾」两段，不要求整个文件进内存。
 *
 * 依赖 File.slice（Web 标准，Node 22 也有），因此可直接进 node --test——
 * 这补上了「纯逻辑测了、调用点没测」的漏洞。
 */
export async function parseMotionPhotoFile(file: Blob): Promise<MotionPhotoInfo> {
  const total = file.size;
  const empty: MotionPhotoInfo = {
    isMotionPhoto: false,
    videoOffset: null,
    videoLength: null,
    version: null,
    legacyMicroVideoOffset: null,
  };
  if (total < 1024) return empty;

  // ① 读文件头解 XMP（XMP 在 APP1 / meta box，256 KB 足够覆盖）
  const head = new Uint8Array(await file.slice(0, Math.min(total, 256 * 1024)).arrayBuffer());
  const header = parseMotionPhotoHeader(head);

  // 显式否定优先（同上，不做兜底扫描）
  if (header.motionPhotoFlag !== null && header.motionPhotoFlag <= 0) {
    return { ...empty, version: header.version, legacyMicroVideoOffset: header.legacyMicroVideoOffset };
  }

  /** 独立读 8 字节验证 ftyp 魔数——不依赖任何元数据自证 */
  const hasFtypAt = async (offset: number): Promise<boolean> => {
    if (offset <= 1024 || offset + 8 > total) return false;
    const m = new Uint8Array(await file.slice(offset + 4, offset + 8).arrayBuffer());
    return FTYP.every((b, i) => m[i] === b);
  };

  // ② 新标准：Item:Length + Item:Padding（从尾算）
  const declared = header.declaredVideoLength;
  if (declared !== null && declared > 0) {
    const padding = header.declaredVideoPadding ?? 0;
    const offset = total - declared - padding;
    if (offset > 1024 && declared + padding < total && (await hasFtypAt(offset))) {
      return {
        isMotionPhoto: true,
        videoOffset: offset,
        videoLength: declared,
        version: header.version,
        legacyMicroVideoOffset: header.legacyMicroVideoOffset,
      };
    }
  }

  // ③ 旧标准：MicroVideoOffset（从尾算）
  const legacy = header.legacyMicroVideoOffset;
  if (legacy !== null && legacy > 0) {
    const offset = total - legacy;
    if (offset > 1024 && legacy < total && (await hasFtypAt(offset))) {
      return {
        isMotionPhoto: true,
        videoOffset: offset,
        videoLength: legacy,
        version: header.version,
        legacyMicroVideoOffset: header.legacyMicroVideoOffset,
      };
    }
  }

  // ④ 兜底：扫文件尾部 32 MB 找 ftyp（XMP 被剥离 / 元数据被裁剪）
  const window = Math.min(total, 32 * 1024 * 1024);
  const tail = new Uint8Array(await file.slice(total - window).arrayBuffer());
  const rel = scanTrailingMp4Offset(tail);
  if (rel === null) return { ...empty, version: header.version };
  const offset = total - window + rel;
  if (offset <= 1024 || offset >= total - 8) {
    return { ...empty, version: header.version };
  }
  return {
    isMotionPhoto: true,
    videoOffset: offset,
    videoLength: total - offset,
    version: header.version,
    legacyMicroVideoOffset: header.legacyMicroVideoOffset,
  };
}

/**
 * 从文件字节中剥离出内嵌 MP4 视频。
 * @param info 解析结果（调用方应复用 plan 阶段已有的 info，避免重复解析）
 */
export function extractMotionPhotoVideo(
  bytes: Uint8Array,
  info: MotionPhotoInfo
): Uint8Array | null {
  if (!info.isMotionPhoto || info.videoOffset === null || info.videoLength === null) {
    return null;
  }
  return bytes.slice(info.videoOffset, info.videoOffset + info.videoLength);
}

/** 是否需要做 Motion Photo 转码（内嵌视频编码非浏览器原生时） */
export function needsMotionPhotoTranscode(info: MotionPhotoInfo): boolean {
  return info.isMotionPhoto && info.videoOffset !== null;
}
