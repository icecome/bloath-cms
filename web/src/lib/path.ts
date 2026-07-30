/**
 * 路径安全校验工具
 * 防止路径穿越攻击 (Path Traversal)
 */

/**
 * 校验并清理目录路径，防止路径穿越
 * - 去除首尾斜杠
 * - 合并连续斜杠
 * - 禁止包含 ..
 * @throws Error 路径包含 .. 时抛出异常
 */
export function sanitizePath(input: string): string {
  const cleaned = input.trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (cleaned.includes('..')) {
    throw new Error('路径不允许包含 ..');
  }
  return cleaned;
}

/**
 * 校验并清理文件 slug，防止路径穿越
 * - 去除 .md 扩展名
 * - 禁止包含路径分隔符 (/ \) 和 ..
 * @throws Error slug 包含非法字符时抛出异常
 */
export function sanitizeSlug(slug: string): string {
  const cleaned = slug.replace(/\.md$/, '').trim();
  if (/[/\\]|\.\./.test(cleaned)) {
    throw new Error('URL 不允许包含路径分隔符或 ..');
  }
  return cleaned;
}

/**
 * 从配置路径列表中提取有效目录，过滤 glob 模式
 * - 去除 /*.md 后缀
 * - 去除尾部斜杠
 * - 过滤掉仍含通配符的路径
 */
export function filterValidDirs(paths: string[]): string[] {
  return paths
    .map(p => p.replace(/\/\*\.md$/, '').replace(/\/+$/, ''))
    .filter(p => p.length > 0 && !p.includes('*'));
}
