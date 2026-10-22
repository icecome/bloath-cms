// mapLimit 单元测试
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from './concurrency.ts';

describe('mapLimit', () => {
  it('空数组返回空数组', async () => {
    const out = await mapLimit([], 3, async (x) => x);
    assert.deepEqual(out, []);
  });

  it('保持返回值与输入顺序一致', async () => {
    const input = [1, 2, 3, 4, 5];
    const out = await mapLimit(input, 2, async (n) => {
      // 倒序延迟：先处理完成的不是先开始的，验证顺序回填
      await new Promise((r) => setTimeout(r, (6 - n) * 5));
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
  });

  it('并发数不超过 limit', async () => {
    let active = 0;
    let peak = 0;
    const input = Array.from({ length: 10 }, (_, i) => i);
    await mapLimit(input, 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
    assert.equal(peak, 3);
  });

  it('任一失败整体抛出', async () => {
    await assert.rejects(
      () => mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
      /boom/
    );
  });

  it('limit 大于数组长度时按数组长度起 worker', async () => {
    const out = await mapLimit([1, 2], 10, async (n) => n * 2);
    assert.deepEqual(out, [2, 4]);
  });
});
