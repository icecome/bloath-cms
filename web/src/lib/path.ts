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

export function filterValidDirs(paths: string[]): string[] {
  return paths
    .map(p => p.replace(/\/\*\.md$/, '').replace(/\/+$/, ''))
    .filter(p => p.length > 0 && !p.includes('*'));
}

/**
 * 目标路径去重：多文件同批移动到同一目录时，同名文件给后续者追加序号，
 * 防止 Git 树中同名条目互相覆盖导致内容丢失。保持输入顺序一致。
 * 例：["trash/a.md", "trash/a.md", "trash/b.md"] → ["trash/a.md", "trash/a-2.md", "trash/b.md"]
 */
export function dedupeTargetPaths(targetPaths: string[]): string[] {
  const seen = new Map<string, number>();
  return targetPaths.map((path) => {
    const baseCount = seen.get(path) ?? 0;
    seen.set(path, baseCount + 1);
    if (baseCount === 0) return path;
    const dot = path.lastIndexOf('.');
    const stem = dot > 0 ? path.slice(0, dot) : path;
    const ext = dot > 0 ? path.slice(dot) : '';
    return `${stem}-${baseCount + 1}${ext}`;
  });
}
