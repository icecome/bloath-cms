/**
 * 重命名占位符解析器
 * 支持的占位符：
 * {Y} - 年份 4 位
 * {m} - 月份 2 位
 * {d} - 日期 2 位
 * {h} - 小时 2 位
 * {i} - 分钟 2 位
 * {s} - 秒 2 位
 * {filename} - 原始文件名（无扩展名）
 * {str-n} - n 位随机字符串
 */

function padZero(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    // 拒绝采样消除模偏差：252 = floor(255/36)*36
    if (bytes[i] >= 252) i--;
    result += chars[bytes[i] % chars.length];
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
