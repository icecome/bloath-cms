import type { EnhancedFileItem } from '../lib/extractFrontMatter';
import type { RepoInfo } from '../../../shared/types';

interface CacheEntry {
  files: EnhancedFileItem[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟（Front Matter 提取耗时较长，延长缓存时间）
const MAX_ENTRIES = 50; // 最大缓存条目数，超出时淘汰最早的条目

function getCacheKey(repo: RepoInfo, basePath: string): string {
  return `${repo.owner}/${repo.repo}/${repo.branch || 'main'}/${basePath}`;
}

export function getCachedFiles(repo: RepoInfo, basePath: string): EnhancedFileItem[] | null {
  const key = getCacheKey(repo, basePath);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.files;
}

export function setCachedFiles(repo: RepoInfo, basePath: string, files: EnhancedFileItem[]): void {
  const key = getCacheKey(repo, basePath);
  // 超出上限时淘汰最早的条目（Map 按插入顺序迭代）
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { files, timestamp: Date.now() });
}

export function clearCache(repo: RepoInfo, basePath?: string): void {
  if (basePath) {
    const key = getCacheKey(repo, basePath);
    cache.delete(key);
  } else {
    const prefix = `${repo.owner}/${repo.repo}/${repo.branch || 'main'}/`;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
      }
    }
  }
}

export function clearAllCache(): void {
  cache.clear();
}
