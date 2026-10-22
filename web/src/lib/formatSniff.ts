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
