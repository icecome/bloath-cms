// 上传文件格式嗅探（P3-3）：读文件魔数（magic bytes）判定真实类型，
// 防止改扩展名绕过 `image/*` 过滤的文件进入上传管线。
// 对齐 Sveltia sniff.js 的思路：扩展名与 MIME 均可伪造，唯魔数可信。

/** 已识别的图片格式签名（按前缀匹配，顺序即判定顺序） */
const SIGNATURES: Array<{ format: string; bytes: number[]; offset?: number }> = [
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { format: 'gif', bytes: [0x47, 0x49, 0x46] },
  { format: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // RIFF....WEBP
  { format: 'bmp', bytes: [0x42, 0x4d] },
  { format: 'avif', bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], offset: 4 }, // ....ftypavif
];

/** 需要排除的伪装高危格式（可执行/脚本内容） */
const DANGEROUS_SIGNATURES: Array<{ label: string; bytes: number[] }> = [
  { label: 'EXE', bytes: [0x4d, 0x5a] },                                  // MZ（Windows PE）
  { label: 'ELF', bytes: [0x7f, 0x45, 0x4c, 0x46] },                      // Linux ELF
  { label: 'shell', bytes: [0x23, 0x21] },                                // #!（脚本 shebang）
  { label: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] },                      // %PDF
];

/** ISO BMFF 的 major brand → 具体容器（HEIC 与视频容器共用 ftyp 头，此处一并解析） */
function brandToFormat(brand: string): { kind: MediaSniffKind; format: string } {
  const b = brand.trim();
  // HEIC/HEIF 主图（iPhone Live Photo 主图）：heic/heix 为 HEVC 静态图，
  // mif1/mif2 为 HEIF 通用容器（可能是 HEVC 或 AV1 内编码图）
  if (b === 'heic' || b === 'heix' || b === 'hevc' || b === 'hevx' || b === 'mif1' || b === 'mif2') {
    return { kind: 'image', format: 'heic' };
  }
  if (b === 'qt') return { kind: 'video', format: 'mov' };
  if (b === 'M4V' || b === 'M4VH' || b === 'M4VP') return { kind: 'video', format: 'm4v' };
  // isom / iso2 / iso4 / mp41 / mp42 / avc1 / dash / MSNV 等一律按 mp4 处理
  return { kind: 'video', format: 'mp4' };
}

/**
 * 读取文件头部魔数，返回嗅探出的格式标识。
 * @returns 命中的图片格式（jpeg/png/gif/webp/bmp/avif）；
 *          伪装的可执行/脚本返回 'dangerous:<label>'；
 *          无法识别返回 'unknown'。
 */
export async function sniffImageFormat(file: File): Promise<string> {
  const header = new Uint8Array(Math.max(16, ...SIGNATURES.map((s) => (s.offset ?? 0) + s.bytes.length)));
  const read = await file.slice(0, header.length).arrayBuffer();
  header.set(new Uint8Array(read));

  // 先排除伪装格式：任何「图片扩展名 + 可执行魔数」组合直接拒绝
  for (const sig of DANGEROUS_SIGNATURES) {
    if (matchesAt(header, sig.bytes, 0)) return `dangerous:${sig.label}`;
  }

  for (const sig of SIGNATURES) {
    if (matchesAt(header, sig.bytes, sig.offset ?? 0)) return sig.format;
  }

  return 'unknown';
}

function matchesAt(header: Uint8Array, sig: number[], offset: number): boolean {
  if (header.length < offset + sig.length) return false;
  return sig.every((byte, i) => header[offset + i] === byte);
}

// ---------- 视频容器嗅探 ----------
//
// 判据与图片一致：只信魔数。视频的扩展名尤其不可信（录屏软件、下载工具、聊天软件
// 转存都会改扩展名），因此这里按容器头判定，并由调用方据此纠正落盘扩展名。

export type MediaSniffKind = 'image' | 'video' | 'unknown';

export interface MediaSniffResult {
  kind: MediaSniffKind;
  /** 具体格式标识：jpeg/png/mp4/webm/…；'dangerous:XXX' 表示伪装的可执行内容 */
  format: string;
}

/** 需要读取的头部字节数：要覆盖 ftyp 的 major brand（offset 4..12）与 EBML 头 */
const SNIFF_BYTES = 64;

/** SVG 是文本格式，无二进制魔数：读头部按文本判定 */
async function isSvgText(file: File): Promise<boolean> {
  const head = new TextDecoder().decode(await file.slice(0, 512).arrayBuffer());
  // 去掉 BOM 与前置空白后再判定，避免「<?xml ... ?><svg」带换行时漏判
  const trimmed = head.replace(/^\uFEFF/, '').trimStart();
  return trimmed.startsWith('<svg') || trimmed.startsWith('<?xml');
}

/**
 * 嗅探文件类型（图片或视频）。
 *
 * 判定顺序：高危伪装 → 图片魔数 → 视频容器魔数 → unknown。
 * 高危优先，保证「改名成 .mp4 的 PE 文件」不会因为容器判定宽松而漏网。
 */
export async function sniffMedia(file: File): Promise<MediaSniffResult> {
  const header = new Uint8Array(SNIFF_BYTES);
  const read = await file.slice(0, SNIFF_BYTES).arrayBuffer();
  header.set(new Uint8Array(read));

  // 1. 高危伪装（优先级最高）
  for (const sig of DANGEROUS_SIGNATURES) {
    if (matchesAt(header, sig.bytes, 0)) {
      return { kind: 'unknown', format: `dangerous:${sig.label}` };
    }
  }

  // 2. 图片
  for (const sig of SIGNATURES) {
    if (matchesAt(header, sig.bytes, sig.offset ?? 0)) {
      return { kind: 'image', format: sig.format };
    }
  }

  // 3. ISO BMFF：offset 4 处 'ftyp'，offset 8..12 是 major brand
  //    视频容器（mp4/mov/m4v）与 HEIC/HEIF 主图共用 ftyp 头，统一走 brandToFormat 解析
  if (matchesAt(header, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...header.slice(8, 12));
    return brandToFormat(brand);
  }

  // 4. Matroska / WebM：同为 EBML 头，靠 DocType 区分
  if (matchesAt(header, [0x1a, 0x45, 0xdf, 0xa3], 0)) {
    const text = String.fromCharCode(...header);
    if (text.includes('webm')) return { kind: 'video', format: 'webm' };
    // matroska 容器浏览器无法播放，交由上层拒绝（给出「请转 MP4/WebM」提示）
    if (text.includes('matroska')) return { kind: 'video', format: 'matroska' };
    return { kind: 'video', format: 'webm' };
  }

  // 5. Ogg（ogv 是 Ogg 容器里的 Theora 视频）
  if (matchesAt(header, [0x4f, 0x67, 0x67, 0x53], 0)) {
    return { kind: 'video', format: 'ogv' };
  }

  // 6. AVI：RIFF....AVI␠
  if (matchesAt(header, [0x52, 0x49, 0x46, 0x46], 0) && matchesAt(header, [0x41, 0x56, 0x49, 0x20], 8)) {
    return { kind: 'video', format: 'avi' };
  }

  // 7. SVG：文本格式，无魔数，最后判定（避免与其它二进制格式的文本片段误撞）
  if (await isSvgText(file)) {
    return { kind: 'image', format: 'svg' };
  }

  return { kind: 'unknown', format: 'unknown' };
}


/**
 * 上传前的格式校验：声称的图片扩展名必须与魔数一致。
 * @returns null = 通过；非 null = 用户可读的拒绝理由。
 */
export async function validateImageUpload(file: File): Promise<string | null> {
  const sniffed = await sniffImageFormat(file);

  if (sniffed.startsWith('dangerous:')) {
    return `「${file.name}」实际内容是 ${sniffed.slice('dangerous:'.length)}，与图片扩展名不符，已拒绝上传`;
  }

  const claimed = (file.name.split('.').pop() ?? '').toLowerCase();
  const claimedNormalized =
    claimed === 'jpg' ? 'jpeg' :
    claimed === 'tif' ? 'tiff' :
    claimed === 'svg' ? 'svg' :
    claimed;

  // SVG 是文本格式，无二进制魔数：单独判定（必须是 XML 文本）
  if (claimedNormalized === 'svg') {
    const head = new TextDecoder().decode(await file.slice(0, 256).arrayBuffer());
    if (!head.includes('<svg') && !head.includes('<?xml')) {
      return `「${file.name}」不是有效的 SVG 文本，已拒绝上传`;
    }
    return null;
  }

  if (sniffed === 'unknown') {
    return `「${file.name}」无法识别为图片格式，已拒绝上传`;
  }

  if (sniffed !== claimedNormalized) {
    return `「${file.name}」实际格式是 ${sniffed}，与扩展名 .${claimed} 不符，已拒绝上传`;
  }

  return null;
}
