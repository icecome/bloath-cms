import type { EnhancedFileItem, RepoInfo } from '../lib/extractFrontMatter';

interface CacheEntry {
  files: EnhancedFileItem[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟（Front Matter 提取耗时较长，延长缓存时间）

function getCacheKey(repo: RepoInfo, basePath: string): string {
  return `${repo.owner}/${repo.repo}/${repo.branch}/${basePath}`;
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
  cache.set(key, { files, timestamp: Date.now() });
}

export function clearCache(repo: RepoInfo, basePath?: string): void {
  if (basePath) {
    const key = getCacheKey(repo, basePath);
    cache.delete(key);
  } else {
    // 清除该仓库所有缓存
    const prefix = `${repo.owner}/${repo.repo}/${repo.branch}/`;
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
