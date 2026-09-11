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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 从 front-matter date 解析文章日期；支持 Date 与字符串；无效则回落当前时间 */
export function parseFrontmatterDate(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

export function formatYyyymmdd(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

export function formatHhmmss(date: Date): string {
  return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

/** slug 核心词：仅保留 a-z0-9-，并去掉误粘的日期前缀 */
export function sanitizeSlugCore(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^\d{8}-/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 构造 front-matter slug：
 * - 有核心词 → YYYYMMDD-核心词（日期取文章日期）
 * - 无核心词 → YYYYMMDD-hhmmss（日期取文章日期，时间取生成时刻，避免午夜 000000 碰撞）
 */
export function buildFrontmatterSlug(
  date: Date,
  coreInput?: string,
  now: Date = new Date()
): string {
  const day = formatYyyymmdd(date);
  const core = sanitizeSlugCore(coreInput ?? '');
  if (core) return `${day}-${core}`;
  return `${day}-${formatHhmmss(now)}`;
}

/** 旧文：仅当用户填写了核心词才生成 slug，否则返回 null（避免改写既有 URL） */
export function resolveExistingSlug(date: Date, coreInput?: string): string | null {
  const core = sanitizeSlugCore(coreInput ?? '');
  if (!core) return null;
  return `${formatYyyymmdd(date)}-${core}`;
}

/** 标题清洗为文件名片段：去掉 Windows 非法字符与常见标点 */
export function cleanTitleForFilename(title: string): string {
  let s = (title || '').trim();
  s = s.replace(/[\\/:*?"<>|]/g, '');
  s = s.replace(/[、，。！？；：""''《》【】（）[\]{}·…—–\s]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) return '未命名';
  if (s.length > 40) {
    s = s.slice(0, 40).replace(/-+$/, '');
  }
  return s || '未命名';
}

/** 文件名：YYYYMMDD-标题清洗.md（与 slug 解耦） */
export function buildArticleFilename(date: Date, title: string): string {
  return `${formatYyyymmdd(date)}-${cleanTitleForFilename(title)}.md`;
}

export function fileStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() || '';
  return base.replace(/\.md$/, '');
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
