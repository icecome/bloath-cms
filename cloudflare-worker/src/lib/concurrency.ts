// 并发控制工具（跨模块共用）

/**
 * 有上限的并发映射，保持返回值与输入顺序一致。
 *
 * 从 buffer.service.ts 提取：github.ts 的 extractFrontMatters 与
 * web/src/lib/extractFrontMatter.ts 的 batchFetchFallback 各自用
 * 「for 循环切片 + Promise.all」实现了同语义逻辑，三处参数不同（8 / 5 / 20）
 * 但机制一致，统一到此处。
 *
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
