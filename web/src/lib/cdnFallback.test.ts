// cdnFallback 纯逻辑测试（换域重试序列）。
// 运行：node --experimental-strip-types --test-reporter=spec --test src/lib/cdnFallback.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableCdnUrl, nextCdnFallback } from './cdnFallback.ts';

const IMG = 'https://testingcf.jsdelivr.net/gh/icecome/img@main/2026/10/a.webp';
const PATH = 'icecome/img@main/2026/10/a.webp';

test('isRetryableCdnUrl：识别三个候选域', () => {
  assert.equal(isRetryableCdnUrl(IMG), true);
  assert.equal(isRetryableCdnUrl(`https://gcore.jsdelivr.net/gh/${PATH}`), true);
  assert.equal(isRetryableCdnUrl(`https://cdn.jsdmirror.cn/gh/${PATH}`), true);
});

test('isRetryableCdnUrl：不匹配 S3 / 自定义 / raw / 非 /gh/ 路径', () => {
  assert.equal(isRetryableCdnUrl(`https://img.icecome.com/${PATH}`), false, 'S3 公网基址不可换域');
  assert.equal(isRetryableCdnUrl(`https://raw.githubusercontent.com/${PATH}`), false);
  assert.equal(isRetryableCdnUrl('https://testingcf.jsdelivr.net/npm/vue/dist/vue.js'), false, 'npm 而非 gh');
  assert.equal(isRetryableCdnUrl(''), false);
  assert.equal(isRetryableCdnUrl('not-a-url'), false);
});

test('nextCdnFallback：首发失败切换到第二候选域，路径完整保留', () => {
  assert.equal(nextCdnFallback(IMG), `https://gcore.jsdelivr.net/gh/${PATH}`);
});

test('nextCdnFallback：依次推进，试尽返回 null（不死循环）', () => {
  const first = nextCdnFallback(IMG)!;
  assert.equal(first, `https://gcore.jsdelivr.net/gh/${PATH}`);
  const second = nextCdnFallback(first)!;
  assert.equal(second, `https://cdn.jsdmirror.cn/gh/${PATH}`);
  assert.equal(nextCdnFallback(second), null, '第三个候选之后必须终止');
});

test('nextCdnFallback：末位域（jsdmirror.cn）失败即终止', () => {
  assert.equal(nextCdnFallback(`https://cdn.jsdmirror.cn/gh/${PATH}`), null);
});

test('nextCdnFallback：非候选域返回 null（不误换）', () => {
  assert.equal(nextCdnFallback(`https://img.icecome.com/${PATH}`), null);
  assert.equal(nextCdnFallback('https://raw.githubusercontent.com/icecome/img/main/a.webp'), null);
});

test('nextCdnFallback：query 与 hash 随路径保留', () => {
  const url = `https://testingcf.jsdelivr.net/gh/${PATH}?v=2`;
  assert.equal(nextCdnFallback(url), `https://gcore.jsdelivr.net/gh/${PATH}?v=2`);
});
