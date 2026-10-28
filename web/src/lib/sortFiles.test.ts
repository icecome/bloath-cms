// 列表排序回归测试。
// 背景：2026-09-09 起 sortByFrontMatterDate 改为非破坏性（返回新数组），
// 但调用点仍按副作用方式调用，排序静默失效，两个月后才被发现。
// 本文件锁死三件事：不是空操作、比较器是全序、输出与输入顺序无关。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortByFrontMatterDate,
  sortByLastModified,
  timeSortKey,
  extractTimestampFromFilename,
} from './sortFiles.ts';
import { parseDateToTimestamp } from './dateParse.ts';

const D = (s: string) => new Date(`${s}T00:00:00+08:00`).getTime();
const file = (name: string, path: string, sortDate = 0) => ({ name, path, sortDate });

describe('sortByFrontMatterDate', () => {
  it('不修改入参，返回新数组', () => {
    const input = [
      file('20260101-a.md', 'c/a.md', D('2026-08-01')),
      file('20260102-b.md', 'c/b.md', D('2026-06-01')),
    ];
    const before = input.map((f) => f.name).join(',');
    const out = sortByFrontMatterDate(input);
    assert.notEqual(out, input);
    assert.equal(input.map((f) => f.name).join(','), before);
  });

  it('文件内时间字段优先，降序', () => {
    const out = sortByFrontMatterDate([
      file('a.md', 'c/a.md', D('2026-01-01')),
      file('b.md', 'c/b.md', D('2026-12-31')),
    ]);
    assert.deepEqual(out.map((f) => f.name), ['b.md', 'a.md']);
  });

  it('无文件内时间时回退文件名时间', () => {
    const out = sortByFrontMatterDate([
      file('20260707-old.md', 'c/old.md'),
      file('20261113-new.md', 'c/new.md'),
    ]);
    assert.deepEqual(out.map((f) => f.name), ['20261113-new.md', '20260707-old.md']);
  });

  it('混合有无时间的数据：不存在相邻逆序（全序）', () => {
    const out = sortByFrontMatterDate([
      file('20261001-x.md', 'c/x.md', D('2026-01-05')),
      file('20260601-y.md', 'c/y.md'),
      file('20260101-z.md', 'c/z.md', D('2026-12-20')),
      file('about.md', 'c/about.md'),
    ]);
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      assert.ok(a && b);
      assert.ok(timeSortKey(a) >= timeSortKey(b), `第 ${i} 位逆序：${a.name} → ${b.name}`);
    }
  });

  it('输入顺序不影响结果（旧比较器在这条上会失败）', () => {
    const list = [
      file('20261001-x.md', 'c/x.md', D('2026-01-05')),
      file('20260601-y.md', 'c/y.md'),
      file('20260101-z.md', 'c/z.md', D('2026-12-20')),
    ];
    const forward = sortByFrontMatterDate(list).map((f) => f.path);
    const backward = sortByFrontMatterDate([...list].reverse()).map((f) => f.path);
    assert.deepEqual(forward, backward);
  });

  it('同时间按 path 稳定排序，无任何时间信息也不乱', () => {
    const out = sortByFrontMatterDate([file('b.md', 'c/b.md'), file('a.md', 'c/a.md')]);
    assert.deepEqual(out.map((f) => f.path), ['c/a.md', 'c/b.md']);
  });

  it('sortDate 与 frontmatter.date 同时存在时以 sortDate 为准', () => {
    const out = sortByFrontMatterDate([
      {
        name: 'a.md',
        path: 'c/a.md',
        sortDate: D('2026-09-09'),
        frontmatter: { date: '2026-01-01' } as never,
      },
    ]);
    assert.equal(timeSortKey(out[0] as never), D('2026-09-09'));
  });
});

describe('extractTimestampFromFilename', () => {
  it('支持紧凑与带分隔符两种写法', () => {
    assert.ok(extractTimestampFromFilename('20260707-post.md') > 0);
    assert.ok(extractTimestampFromFilename('20260707123045-post.md') > 0);
    assert.ok(extractTimestampFromFilename('2026-07-07-post.md') > 0);
    assert.ok(extractTimestampFromFilename('2026_07_07-post.md') > 0);
  });

  it('无时间信息或非法日期返回 0', () => {
    assert.equal(extractTimestampFromFilename('post.md'), 0);
    assert.equal(extractTimestampFromFilename('about.md'), 0);
    assert.equal(extractTimestampFromFilename('20261313-bad.md'), 0);
  });
});

describe('sortByLastModified', () => {
  it('按 lastModified 降序，缺失时用文件名兜底', () => {
    const out = sortByLastModified([
      { name: '20260707-old.md', lastModified: 0 },
      { name: 'x.md', lastModified: D('2026-12-01') },
    ]);
    assert.deepEqual(out.map((f) => f.name), ['x.md', '20260707-old.md']);
  });
});

describe('parseDateToTimestamp', () => {
  it('8 位 YYYYMMDD 数字按日期解析（不再当成 1970 毫秒）', () => {
    const ts = parseDateToTimestamp(20260707);
    assert.equal(new Date(ts).getFullYear(), 2026);
    assert.equal(new Date(ts).getMonth(), 6);
    assert.equal(new Date(ts).getDate(), 7);
  });

  it('10 位秒级时间戳换算成毫秒', () => {
    const ts = parseDateToTimestamp(1767225600);
    assert.equal(new Date(ts).getUTCFullYear(), 2026);
    assert.equal(ts, 1767225600000);
  });

  it('13 位毫秒时间戳原样返回', () => {
    assert.equal(parseDateToTimestamp(1767225600000), 1767225600000);
  });

  it('字符串日期与中文日期可解析', () => {
    assert.ok(parseDateToTimestamp('2026-07-07') > 0);
    assert.ok(parseDateToTimestamp('2026/07/07') > 0);
    assert.ok(parseDateToTimestamp('20260707') > 0);
    assert.ok(parseDateToTimestamp('2026年7月7日') > 0);
    assert.ok(parseDateToTimestamp('1767225600') > 0);
  });

  it('Date 对象与非法输入', () => {
    assert.equal(parseDateToTimestamp(new Date(1767225600000)), 1767225600000);
    assert.equal(parseDateToTimestamp(''), 0);
    assert.equal(parseDateToTimestamp(undefined), 0);
    assert.equal(parseDateToTimestamp(0), 0);
    assert.equal(parseDateToTimestamp('not a date'), 0);
  });
});
