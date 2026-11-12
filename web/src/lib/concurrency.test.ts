// mapLimit 语义锁（与 worker 侧 lib/concurrency.ts 的同名测试互为镜像）。
//
// 【为什么前端也要一份】`web/src/lib/concurrency.ts` 与
// `cloudflare-worker/src/lib/concurrency.ts` 是逐字同构的两份实现——运行环境隔离
// 使共享源码不可行（AGENTS.md §4 铁律 1 的既有例外）。两份实现一旦分叉，
// 前端批量发布与后端批量提交的行为就会不一致，且编译期毫无提示。
//
// 本文件断言的是**语义契约**，不是实现细节：两侧改实现可以，改语义必须两边同时改测试。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from './concurrency.ts';

/** 让出事件循环，便于观察并发窗口 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('mapLimit / 结果与顺序', () => {
  test('返回值顺序与输入顺序一致（不按完成先后）', async () => {
    // 故意让前面的慢、后面的快：按完成顺序返回会得到 [3,2,1]
    const delays = [30, 20, 10];
    const result = await mapLimit([1, 2, 3], 3, async (n) => {
      await new Promise((r) => setTimeout(r, delays[n - 1]));
      return n;
    });
    assert.deepEqual(result, [1, 2, 3]);
  });

  test('空数组立即返回空数组（不抛错、不启动 worker）', async () => {
    let called = 0;
    const result = await mapLimit([], 4, async () => { called++; return 0; });
    assert.deepEqual(result, []);
    assert.equal(called, 0);
  });

  test('fn 收到原始元素与索引', async () => {
    const seen: Array<[string, number]> = [];
    await mapLimit(['a', 'b'], 2, async (item, index) => {
      seen.push([item, index]);
      return item;
    });
    assert.deepEqual(seen.sort(), [['a', 0], ['b', 1]]);
  });
});

describe('mapLimit / 并发上限', () => {
  test('并发数不超过 limit（关键约束：禁止无上限 Promise.all）', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return 0;
    });
    assert.ok(peak <= 3, `并发峰值 ${peak} 超过上限 3`);
    assert.equal(peak, 3, '应当跑满上限（否则是串行执行，性能回归）');
  });

  test('limit 大于元素数时按元素数并发', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit([1, 2], 100, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return 0;
    });
    assert.equal(peak, 2);
  });

  test('limit 为 0 或负数时不死锁（workers 数为 min(limit, len)，0 会让 while 无限循环）', async () => {
    // 现状：limit<=0 时 Math.min(limit, len) <= 0 → RangeError 或死循环，属于调用方错误。
    // 本用例锁定「不静默挂起」：要么抛错，要么返回，不允许永久 pending。
    const outcome = await Promise.race([
      mapLimit([1, 2, 3], 0, async (n) => n).then(() => 'returned').catch(() => 'threw'),
      new Promise<string>((r) => setTimeout(() => r('hung'), 100)),
    ]);
    assert.notEqual(outcome, 'hung', 'limit=0 不得导致永久挂起');
  });
});

describe('mapLimit / 错误传播', () => {
  test('任一 fn 抛错则整体 reject（不返回部分结果）', async () => {
    await assert.rejects(
      async () => {
        await mapLimit([1, 2, 3], 2, async (n) => {
          if (n === 2) throw new Error('boom');
          return n;
        });
      },
      /boom/
    );
  });

  test('抛错后不再继续处理剩余元素（尽快失败）', async () => {
    let processed = 0;
    await assert.rejects(async () => {
      await mapLimit(Array.from({ length: 50 }, (_, i) => i), 1, async (n) => {
        processed++;
        if (n === 2) throw new Error('boom');
        return n;
      });
    });
    assert.ok(processed < 50, `抛错后应尽快停止，实际处理了 ${processed} 个`);
  });
});
