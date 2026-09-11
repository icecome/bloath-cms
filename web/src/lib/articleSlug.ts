import type { Frontmatter } from './frontmatter';
import type { SiteProfile } from '../../../shared/profiles';
import {
  parseFrontmatterDate,
  buildFrontmatterSlug,
  resolveExistingSlug,
  buildArticleFilename,
  fileStemFromPath,
  sanitizeSlug,
  sanitizeSlugCore
} from './path';

export interface ResolvePathAndSlugOptions {
  fm: Frontmatter;
  profile: SiteProfile;
  isNew: boolean;
  forceNew?: boolean;
  currentFilePath: string;
  routeSlug: string;
  /** 加载时记录的原始 slug；清空表单时用于防止误删已有 slug */
  initialSlug?: string;
  /** coupled 模式下新建时的默认 slug（URL=文件名旧行为） */
  defaultCoupledSlug?: () => string;
}

export interface ResolvePathAndSlugResult {
  fileStem: string;
  frontmatterUrl?: string;
  /** 用户填写的核心词被清洗为空（例如中文） */
  coreDropped?: boolean;
}

function coreInputFromFm(fm: Frontmatter): string {
  return typeof fm.url === 'string' ? fm.url.trim() : '';
}

/**
 * 解析保存/发布用的路径名（无 .md）与 front-matter slug。
 * decoupled：文件名来自标题清洗，slug 来自表单或自动生成；
 * coupled：沿用 URL 字段 = 文件名的旧行为。
 */
export function resolvePathAndSlug(options: ResolvePathAndSlugOptions): ResolvePathAndSlugResult {
  const {
    fm,
    profile,
    isNew,
    forceNew = false,
    currentFilePath,
    routeSlug,
    initialSlug,
    defaultCoupledSlug
  } = options;

  if (profile.urlFilenameMode === 'decoupled') {
    const articleDate = parseFrontmatterDate(fm.date);
    const rawCore = coreInputFromFm(fm);
    const core = sanitizeSlugCore(rawCore);
    const coreDropped = rawCore.length > 0 && core.length === 0;

    if (isNew || forceNew) {
      // 已有文章发布/重发布：表单清空时保留加载时的 slug，避免误改 URL
      if (!isNew && !core && initialSlug) {
        const fileStem = currentFilePath
          ? fileStemFromPath(currentFilePath)
          : fileStemFromPath(buildArticleFilename(articleDate, String(fm.title || '')));
        return { fileStem, frontmatterUrl: initialSlug, coreDropped };
      }
      const slugValue = buildFrontmatterSlug(articleDate, rawCore);
      const fileStem = fileStemFromPath(
        buildArticleFilename(articleDate, String(fm.title || ''))
      );
      return { fileStem, frontmatterUrl: slugValue, coreDropped };
    }

    const fileStem = currentFilePath ? fileStemFromPath(currentFilePath) : routeSlug;
    if (!core && initialSlug) {
      // 清空表单不删除已有 slug
      return { fileStem, frontmatterUrl: initialSlug, coreDropped };
    }
    const existing = resolveExistingSlug(articleDate, rawCore);
    return { fileStem, frontmatterUrl: existing ?? undefined, coreDropped };
  }

  const raw =
    typeof fm.url === 'string' && fm.url
      ? fm.url
      : (isNew
          ? (defaultCoupledSlug?.() ?? routeSlug)
          : routeSlug);
  const fileStem = sanitizeSlug(raw);
  return { fileStem, frontmatterUrl: raw };
}
