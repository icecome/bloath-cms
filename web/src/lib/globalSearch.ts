// 全局搜索：跨内容库/草稿/回收站的标题与标签匹配（P2-5）。
//
// 数据源：三处列表页共享的树级快照缓存（fileSnapshot）与内存文件缓存（fileCache）——
// 列表页访问过即有数据，搜索不触发网络。
//
// 评分口径（对齐 Sveltia search/entries.js 的加权思路，简化为三级）：
// - 标题命中 10 分；标签命中 5 分；文件名/路径命中 2 分；
// - 多处命中叠加（标题+标签 = 15 分，权重排序天然把「标题即关键词」排前）。
import type { EnhancedFileItem } from './extractFrontMatter';

export const SEARCH_WEIGHT_TITLE = 10;
export const SEARCH_WEIGHT_TAG = 5;
export const SEARCH_WEIGHT_PATH = 2;

/** 单条搜索结果 */
export interface GlobalSearchResult {
  item: EnhancedFileItem;
  /** 权重得分（越高越相关） */
  score: number;
  /** 命中来源（供 UI 展示「为什么命中」） */
  matchedIn: Array<'title' | 'tag' | 'path'>;
}

/**
 * 扫描单个条目对搜索词的匹配度；未命中返回 null。
 * 匹配均为大小写不敏感的包含语义（CJK 无大小写，等价于直接包含）。
 */
export function scoreEntry(item: EnhancedFileItem, terms: string): GlobalSearchResult | null {
  const q = terms.trim().toLowerCase();
  if (!q) return null;

  const matchedIn: GlobalSearchResult['matchedIn'] = [];
  let score = 0;

  const title = item.frontmatter?.title;
  if (typeof title === 'string' && title.toLowerCase().includes(q)) {
    score += SEARCH_WEIGHT_TITLE;
    matchedIn.push('title');
  }

  const tags = item.frontmatter?.tags;
  if (Array.isArray(tags) && tags.some((t) => typeof t === 'string' && t.toLowerCase().includes(q))) {
    score += SEARCH_WEIGHT_TAG;
    matchedIn.push('tag');
  }

  if (
    item.name.toLowerCase().includes(q) ||
    item.path.toLowerCase().includes(q)
  ) {
    score += SEARCH_WEIGHT_PATH;
    matchedIn.push('path');
  }

  if (score === 0) return null;
  return { item, score, matchedIn };
}

/**
 * 对条目列表执行全局搜索，按得分降序、同分按路径排序。
 */
export function searchEntries(items: EnhancedFileItem[], terms: string): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];
  for (const item of items) {
    const hit = scoreEntry(item, terms);
    if (hit) results.push(hit);
  }
  return results.sort((a, b) =>
    b.score - a.score || a.item.path.localeCompare(b.item.path)
  );
}
