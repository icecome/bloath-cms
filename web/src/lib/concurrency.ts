// 前端并发控制：与 worker 侧 lib/concurrency.ts 同语义的 mapLimit。
// worker 版无法直接 import（路径隔离 + 类型环境不同），此处保持实现一致——
// 若将来语义调整，两侧需同步修改（见 CODE_REUSE_LOG）。
//
// 用途：批量发布（DraftsPage 逐项 publish）、批量删除等多请求循环，
// 替代 for-await 串行（慢）与无上限 Promise.all（打满连接）。

/**
 * 有上限的并发映射，保持返回值与输入顺序一致。
 * 语义：任一 fn 抛错会经 Promise.all(workers) 向上传播（不吞错、不返回部分结果）。
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
