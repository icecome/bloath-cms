// getTree 树缓存的键构造与可用性判定（零依赖纯函数，可进 node --test）。
//
// 【为什么抽出】按 AGENTS.md §4 铁律 3：可单测的业务逻辑放零依赖模块。
// github.ts 本身在 node ESM 下不可加载（GithubApiError 的参数属性语法 +
// shared 值导入缺 .ts 后缀），其缓存判定若不抽出来就没有测试面——
// 而这条判定正是 2026-11-03「媒体库打开即请求超时」里最容易被写错的一层。
//
// 【背景：缓存结构】键 = `tree:{owner}/{repo}:{branch}:{mode}:{headSha}`，
// 值为 FileInfo[] JSON（head-sha 键控 ⇒ head 不变即命中，见 github.ts getTree）。
//
// 【要守住的两个不变量】
// 1. mode 参与键：filename 模式的值带 lastModified，plain 模式的值全是 0。
//    两者混用会让媒体库「最近更新」排序静默退化（R10 事故同型）。
// 2. filename 模式下「全零时间戳」的缓存值不可信：可能是旧实现「在填充前写缓存」
//    留下的脏数据（2026-11-03 修复前 github.ts 的真实顺序）。宁可多走一次
//    全量扇出，也不返回排序坏掉的缓存。
import type { FileInfo } from '../../../shared/types';

/** 树缓存键前缀段（不含 headSha；headSha 由调用方在探测成功后追加） */
export function treeCacheKey(
  owner: string,
  repo: string,
  branch: string,
  mode?: 'filename'
): string {
  return `tree:${owner}/${repo}:${branch}:${mode || 'plain'}`;
}

/**
 * 判定 KV 里解析出的缓存值能否直接返回。
 *
 * @param raw JSON.parse 后的值（任何结构都可能：脏 KV / 老版本写入的形状）
 * @param needLastModified 调用方模式是否需要时间戳（mode === 'filename'）
 * @returns true = 形状合法且时间戳可用，可直接返回；false = 按 miss 处理，走全量
 */
export function isTreeCacheUsable(raw: unknown, needLastModified: boolean): raw is FileInfo[] {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  // 形状校验：每项必须是带 path 的对象（KV 可能被其它模块/手误写入别的 JSON）
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return false;
    if (typeof (item as { path?: unknown }).path !== 'string') return false;
  }
  if (!needLastModified) return true;
  // filename 模式：至少要有一项带正的时间戳。
  // 全 0 ⇒ 要么是「填充前写缓存」时代的旧脏数据，要么仓库确实只有一个初始提交
  // （后者极罕见且代价只是一次扇出）；两种情况都按 miss 走全量重取，
  // 取完在正确位置重写缓存，下一轮即命中干净数据（自愈）。
  return raw.some(
    (item) => typeof (item as { lastModified?: unknown }).lastModified === 'number'
      && (item as { lastModified: number }).lastModified > 0
  );
}
