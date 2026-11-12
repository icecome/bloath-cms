// dateParse 回归测试（R10：带排序/时间语义的纯逻辑必须配同目录 .test.ts）。
//
// 【为什么必须有这份测试】2026-09-09 排序静默失效 7 周（2026-10-27 才发现），
// 根因之一就是 8 位数字日期被当成毫秒。本文件锁死「数值形态判定」这条底线：
// 8 位 YYYYMMDD / 10 位秒 / 13 位毫秒 三类必须正确分流，任何一类错档都会让
// 列表排序键落到 1970。
//
// 【断言策略】本地时区相关的时间戳一律用 `new Date(y, m-1, d, ...)` 现场构造
// 期望值，不写死毫秒常量——CI 是 UTC、本地是 Asia/Shanghai，写死常量会在
// 另一台机器上假红。时区无关的分支（epoch 秒/毫秒）才用算术期望。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateToTimestamp } from './dateParse.ts';

/** 本地时区某时刻的时间戳（与 buildLocalTimestamp 同口径） */
function localTs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

describe('parseDateToTimestamp / 数值形态分流', () => {
  test('8 位数字（number）：20260707 解析为 2026-07-07 本地零点，不是 1970 毫秒', () => {
    const ts = parseDateToTimestamp(20260707);
    assert.equal(ts, localTs(2026, 7, 7));
    // 关键的失败形态回归：旧实现把它当毫秒，落在 1970-01-01
    assert.notEqual(ts, 20260707);
    assert.ok(ts > localTs(2020, 1, 1), '不应掉到 2020 年之前');
  });

  test('8 位数字字符串与 number 同结果（YAML 解析可能给任一形态）', () => {
    assert.equal(parseDateToTimestamp('20260707'), parseDateToTimestamp(20260707));
  });

  test('10 位秒级 epoch：毫秒 = 秒 × 1000', () => {
    assert.equal(parseDateToTimestamp(1751846400), 1751846400000);
    assert.equal(parseDateToTimestamp('1751846400'), 1751846400000);
  });

  test('13 位毫秒级 epoch：原样返回（不二次乘 1000）', () => {
    assert.equal(parseDateToTimestamp(1751846400000), 1751846400000);
    assert.equal(parseDateToTimestamp('1751846400000'), 1751846400000);
  });

  test('非法 8 位日期返回 0 而非被误当秒级 epoch', () => {
    // 99991231 是 8 位合法上界；99999999 的月/日为 99 → 非法
    assert.equal(parseDateToTimestamp(99999999), 0);
    // 年份下界由 buildLocalTimestamp 把控（year < 1970 → 0）：19000101 不在支持范围内
    assert.equal(parseDateToTimestamp(19000101), 0, '1970 之前按无时间处理');
    assert.equal(parseDateToTimestamp(19700101), localTs(1970, 1, 1), '1970-01-01 是合法下界');
  });

  test('边界值：1e9 起算秒，1e11 起算毫秒', () => {
    assert.equal(parseDateToTimestamp(1e9), 1e12, '1e9 恰好是 10 位秒的下界');
    assert.equal(parseDateToTimestamp(1e11), 1e11, '1e11 恰好是 13 位毫秒的下界');
  });
});

describe('parseDateToTimestamp / 字面量日期', () => {
  test('ISO 8601 带 Z：按 UTC 解释', () => {
    assert.equal(parseDateToTimestamp('2026-07-07T12:00:00Z'), Date.UTC(2026, 6, 7, 12, 0, 0));
  });

  test('无时区的日期时间串按本地时区解释（与自建解析同口径）', () => {
    assert.equal(parseDateToTimestamp('2026-07-07 12:00:00'), localTs(2026, 7, 7, 12, 0, 0));
  });

  test('纯日期 YYYY-MM-DD：本地零点', () => {
    assert.equal(parseDateToTimestamp('2026-07-07'), localTs(2026, 7, 7));
  });

  test('下划线分隔 YYYY_MM_DD：与连字符同口径', () => {
    assert.equal(parseDateToTimestamp('2026_07_07'), parseDateToTimestamp('2026-07-07'));
  });

  test('紧凑带时间 20260707123045：解析出时分秒', () => {
    assert.equal(parseDateToTimestamp('20260707123045'), localTs(2026, 7, 7, 12, 30, 45));
  });

  test('中文日期 2026年7月7日：走宽松分支', () => {
    assert.equal(parseDateToTimestamp('2026年7月7日'), localTs(2026, 7, 7));
  });

  test('Date 对象：直接取 getTime()', () => {
    const d = new Date(2026, 6, 7, 12, 0, 0);
    assert.equal(parseDateToTimestamp(d), d.getTime());
  });
});

describe('parseDateToTimestamp / 无时间哨兵', () => {
  test('null / undefined / 空串一律返回 0（可识别的「无时间」哨兵）', () => {
    assert.equal(parseDateToTimestamp(null as unknown as undefined), 0);
    assert.equal(parseDateToTimestamp(undefined), 0);
    assert.equal(parseDateToTimestamp(''), 0);
  });

  test('纯空白字符串返回 0', () => {
    assert.equal(parseDateToTimestamp('   '), 0);
  });

  test('不可解析字符串返回 0', () => {
    assert.equal(parseDateToTimestamp('abc'), 0);
    assert.equal(parseDateToTimestamp('not-a-date'), 0);
  });

  test('非法月份/日期返回 0（月 13、日 32）', () => {
    assert.equal(parseDateToTimestamp('2026-13-01'), 0);
    assert.equal(parseDateToTimestamp('2026-07-32'), 0);
  });

  test('0 与负数返回 0（不把 1970 当有效时间）', () => {
    assert.equal(parseDateToTimestamp(0), 0);
    assert.equal(parseDateToTimestamp(-1), 0);
    assert.equal(parseDateToTimestamp('-1'), 0);
  });

  test('非字符串非数字非 Date 的类型返回 0（防御性，不抛错）', () => {
    assert.equal(parseDateToTimestamp({} as unknown as string), 0);
    assert.equal(parseDateToTimestamp([] as unknown as string), 0);
  });
});

describe('parseDateToTimestamp / 排序键单调性', () => {
  test('混合格式的时间戳可按数值排序，且秒/毫秒同一时刻等值', () => {
    const values: Array<string | number> = [
      '20260707',        // 紧凑 → 2026-07-07
      '2026-01-01',      // 分隔 → 2026-01-01
      '2025-12-31',      // 更早 → 2025-12-31
      '1751846400',      // 秒 → 2025-07-07（本地）
      '1751846400000',   // 毫秒（与上一行同一时刻）
    ];
    const parsed = values.map((v) => parseDateToTimestamp(v));
    assert.ok(parsed.every((v) => v > 0), '全部应解析出正时间戳');

    const sorted = [...parsed].sort((a, b) => a - b);
    assert.equal(sorted[0], 1751846400000, '最旧的是 2025-07-07（秒/毫秒同值）');
    assert.equal(sorted[sorted.length - 1], localTs(2026, 7, 7), '最新的是 2026-07-07');

    assert.equal(
      new Set([parseDateToTimestamp('1751846400'), parseDateToTimestamp('1751846400000')]).size,
      1,
      '秒与毫秒同一时刻必须等值（否则同一天的文章会互相乱序）'
    );
  });
});
