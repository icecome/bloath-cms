function padZero(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  while (result.length < length) {
    const bytes = new Uint8Array(length - result.length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      const byte = bytes[i];
      if (byte === undefined) break;
      if (byte < 252) {
        result += chars[byte % chars.length] ?? '';
      }
    }
  }
  return result;
}

export function resolveRenameTemplate(
  template: string,
  originalFilename?: string
): string {
  const now = new Date();
  const Y = now.getFullYear();
  const m = padZero(now.getMonth() + 1);
  const d = padZero(now.getDate());
  const h = padZero(now.getHours());
  const i = padZero(now.getMinutes());
  const s = padZero(now.getSeconds());

  const filename = originalFilename
    ? originalFilename.replace(/\.[^/.]+$/, '') // 移除扩展名
    : 'image';

  return template.replace(/\{([^}]+)\}/g, (match, placeholder) => {
    switch (placeholder) {
      case 'Y': return String(Y);
      case 'm': return m;
      case 'd': return d;
      case 'h': return h;
      case 'i': return i;
      case 's': return s;
      case 'filename': return filename;
      default: {
        // 处理 {str-n} 格式
        const strMatch = placeholder.match(/^str-(\d+)$/);
        if (strMatch) {
          const len = parseInt(strMatch[1], 10);
          return randomString(len);
        }
        return match; // 未知占位符保持原样
      }
    }
  });
}
