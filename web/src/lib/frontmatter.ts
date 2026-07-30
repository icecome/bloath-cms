import yaml from 'js-yaml';
import type { ArticleFrontmatter } from '../../../shared/types';

export type Frontmatter = ArticleFrontmatter;

export function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return { fm: {}, body: raw.trim() };

  let fm: Frontmatter;
  try {
    const parsed = yaml.load(fmMatch[1] ?? '');
    fm = (parsed && typeof parsed === 'object' ? parsed : {}) as Frontmatter;
    for (const key of ['categories', 'tags', 'pictures', 'video'] as const) {
      if (fm[key] !== undefined && !Array.isArray(fm[key])) {
        (fm as Record<string, unknown>)[key] = [fm[key]];
      }
    }
  } catch {
    fm = {};
  }

  return { fm, body: raw.slice(fmMatch[0].length).trim() };
}

export function generateFrontmatter(fm: Frontmatter): string {
  const cleanFm: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    // url 仅用于控制文件名，不写入 frontmatter
    if (key === 'url') continue;
    if (value !== undefined && value !== '' && value !== null) {
      cleanFm[key] = value;
    }
  }
  if (Object.keys(cleanFm).length === 0) return '---\n---';
  return '---\n' + yaml.dump(cleanFm, { lineWidth: -1 }) + '---';
}
