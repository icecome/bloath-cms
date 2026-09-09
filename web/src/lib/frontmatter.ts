import yaml from 'js-yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { ArticleFrontmatter } from '../../../shared/types';
import { FRONTMATTER_YAML_REGEX, FRONTMATTER_TOML_REGEX } from '../../../shared/types';
import type { FrontmatterFormat, SiteProfile } from '../../../shared/profiles';

export type Frontmatter = ArticleFrontmatter;

// front-matter 定界正则统一来自 shared/types.ts（与 Worker 侧 sliceFrontmatter 共用）
export { FRONTMATTER_YAML_REGEX, FRONTMATTER_TOML_REGEX };

export interface GenerateOptions {
  format?: FrontmatterFormat;
  customFieldsWrapper?: 'params' | 'extra' | null;
  taxonomyWrapper?: 'taxonomies' | null;
}

// TOML 输出时需要转为原生日期（不带引号的 TOML datetime）的键
const TOML_DATE_KEYS = new Set([
  'date', 'lastmod', 'publishDate', 'expiryDate',
  'updated', 'pubDate', 'updatedDate'
]);

// 归一化：单值转数组（categories/tags/pictures/video 允许省略 [] 书写）
function normalizeArrayFields(fm: Record<string, unknown>): void {
  for (const key of ['categories', 'tags', 'pictures', 'video'] as const) {
    const value = fm[key];
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      fm[key] = [value];
    }
  }
}

function parseYamlBody(body: string): Record<string, unknown> {
  try {
    const parsed = yaml.load(body);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseTomlBody(body: string): Record<string, unknown> {
  try {
    const parsed = parseToml(body);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * 解析 front-matter 块文本（不含 --- / +++ 定界符）。
 * 供编辑器加载与列表页聚合提取共用。
 */
export function parseFrontmatterBody(raw: string, format: FrontmatterFormat): Record<string, unknown> {
  const fm = format === 'toml' ? parseTomlBody(raw) : parseYamlBody(raw);
  normalizeArrayFields(fm);
  return fm;
}

/**
 * 解析完整 Markdown：识别 --- （YAML）与 +++ （TOML）两种定界。
 * 注意：wrapper（params/extra/taxonomies）的归并延迟到
 * normalizeFmForProfile，因为解析时 Profile 可能尚未就绪。
 */
export function parseFrontmatter(raw: string): { fm: Frontmatter; body: string; format: FrontmatterFormat } {
  const yamlMatch = raw.match(FRONTMATTER_YAML_REGEX);
  const tomlMatch = raw.match(FRONTMATTER_TOML_REGEX);

  if (yamlMatch) {
    return { fm: parseFrontmatterBody(yamlMatch[1] ?? '', 'yaml') as Frontmatter, body: raw.slice(yamlMatch[0].length).trim(), format: 'yaml' };
  }
  if (tomlMatch) {
    return { fm: parseFrontmatterBody(tomlMatch[1] ?? '', 'toml') as Frontmatter, body: raw.slice(tomlMatch[0].length).trim(), format: 'toml' };
  }
  return { fm: {}, body: raw.trim(), format: 'yaml' };
}

/**
 * 按 Profile 归并 front-matter：
 * - params/extra 块 → customFields（写入时再按 Profile 映射回去，兼容识别、不做迁移）
 * - taxonomies 块 → 顶层 tags/categories
 */
export function normalizeFmForProfile(fm: Frontmatter, profile: SiteProfile): Frontmatter {
  const result: Record<string, unknown> = { ...fm };

  const wrapper = profile.customFieldsWrapper;
  if (wrapper && result[wrapper] && typeof result[wrapper] === 'object' && !Array.isArray(result[wrapper])) {
    const block = result[wrapper] as Record<string, unknown>;
    const existing = (result.customFields && typeof result.customFields === 'object'
      ? result.customFields : {}) as Record<string, unknown>;
    result.customFields = { ...block, ...existing };
    delete result[wrapper];
  }

  const taxonomy = profile.taxonomyWrapper;
  if (taxonomy && result[taxonomy] && typeof result[taxonomy] === 'object' && !Array.isArray(result[taxonomy])) {
    const block = result[taxonomy] as Record<string, unknown>;
    for (const key of ['tags', 'categories'] as const) {
      if (result[key] === undefined && block[key] !== undefined) {
        result[key] = block[key];
      }
    }
    delete result[taxonomy];
  }

  normalizeArrayFields(result);
  return result as Frontmatter;
}

// 禁止作为自定义字段键名的危险属性，防止原型链污染
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'url', 'customFields']);

function cleanCustomFields(fm: Frontmatter): Record<string, unknown> {
  const raw = fm.customFields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || FORBIDDEN_KEYS.has(key) || value === undefined) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function toTomlValue(key: string, value: unknown): unknown {
  if (TOML_DATE_KEYS.has(key) && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) return date;
  }
  return value;
}

/**
 * 按 Profile 生成 front-matter 文本。
 * - url 仅用于控制文件名，不写入 front-matter（现状约定）
 * - customFields 按挂载规则放置：params / extra / 平铺（平铺时跳过与既有字段冲突的键）
 * - Zola：tags/categories 移入 [taxonomies]
 */
export function generateFrontmatter(fm: Frontmatter, options: GenerateOptions = {}): string {
  const {
    format = 'yaml',
    customFieldsWrapper = null,
    taxonomyWrapper = null
  } = options;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (key === 'url' || key === 'customFields') continue;
    if (taxonomyWrapper && (key === 'tags' || key === 'categories')) continue;
    if (value !== undefined && value !== '' && value !== null) {
      clean[key] = format === 'toml' ? toTomlValue(key, value) : value;
    }
  }

  if (taxonomyWrapper) {
    const tax: Record<string, unknown> = {};
    for (const key of ['tags', 'categories'] as const) {
      const value = fm[key];
      if (Array.isArray(value) && value.length > 0) {
        tax[key] = value;
      }
    }
    if (Object.keys(tax).length > 0) {
      clean[taxonomyWrapper] = tax;
    }
  }

  const custom = cleanCustomFields(fm);
  if (Object.keys(custom).length > 0) {
    if (customFieldsWrapper) {
      const existingBlock = (clean[customFieldsWrapper] && typeof clean[customFieldsWrapper] === 'object'
        ? clean[customFieldsWrapper] : {}) as Record<string, unknown>;
      clean[customFieldsWrapper] = { ...existingBlock, ...custom };
    } else {
      // 平铺：跳过与既有字段冲突的键，避免覆盖 title/date 等核心字段
      for (const [key, value] of Object.entries(custom)) {
        if (!(key in clean)) {
          clean[key] = format === 'toml' ? toTomlValue(key, value) : value;
        }
      }
    }
  }

  if (Object.keys(clean).length === 0) {
    return format === 'toml' ? '+++\n+++' : '---\n---';
  }

  if (format === 'toml') {
    const body = stringifyToml(clean);
    return '+++\n' + body + (body.endsWith('\n') ? '' : '\n') + '+++';
  }
  return '---\n' + yaml.dump(clean, { lineWidth: -1 }) + '---';
}

/** 由 Profile 生成 generateFrontmatter 所需选项 */
export function generateOptionsFromProfile(profile: SiteProfile): GenerateOptions {
  return {
    format: profile.format,
    customFieldsWrapper: profile.customFieldsWrapper ?? null,
    taxonomyWrapper: profile.taxonomyWrapper ?? null
  };
}
