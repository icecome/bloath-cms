// mapLimit 语义锁（与 web 侧 lib/concurrency.ts 的同名测试互为镜像）。
//
// 【为什么后端也要一份】两份实现逐字同构但无法共享源码（运行环境隔离）。
// 任何一侧单独改语义（例如把 Promise.all 换成 Promise.allSettled 以「容忍部分失败」），
// 另一侧不会报警。本文件把契约钉死：**任一失败即整体 reject，不返回部分结果**。
// 这与 AGENTS.md R8「需要部分成功的结果时用 Promise.allSettled 并显式处理失败项」
// 是同一条规则的两面——mapLimit 本身不承担部分成功语义。
//
// 【CI 注意】本文件位于 `src/lib/`，历史上 CI 只跑 `src/services/*.test.ts`。
// 2026-11-12 起 workflow 同时执行 lib 与 middleware 的测试，见 .github/workflows/deploy.yml。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from './concurrency.ts';

/** 让出事件循环，便于观察并发窗口 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('mapLimit（worker）/ 结果与顺序', () => {
  test('返回值顺序与输入顺序一致（不按完成先后）', async () => {
    const delays = [30, 20, 10];
    const result = await mapLimit([1, 2, 3], 3, async (n) => {
      await new Promise((r) => setTimeout(r, delays[n - 1]));
      return n;
    });
    assert.deepEqual(result, [1, 2, 3]);
  });

  test('空数组立即返回空数组', async () => {
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

describe('mapLimit（worker）/ 并发上限', () => {
  test('并发数不超过 limit 且能跑满（禁止无上限 Promise.all）', async () => {
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
});

describe('mapLimit（worker）/ 错误传播', () => {
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
