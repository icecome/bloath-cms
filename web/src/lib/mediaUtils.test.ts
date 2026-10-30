// mediaUtils 纯逻辑测试（scaledImageSize / sanitizeMediaFileName / extForFormat）。
// 运行：node --experimental-strip-types --test-reporter=spec --test src/lib/mediaUtils.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaledImageSize, MAX_IMAGE_DIM, sanitizeMediaFileName, extForFormat, thumbnailPathFor, isDerivedAsset } from './mediaUtils.ts';

test('未超限时原样返回（含参考）', () => {
  assert.deepEqual(scaledImageSize(1200, 800), { width: 1200, height: 800 });
  assert.deepEqual(scaledImageSize(1920, 1080), { width: 1920, height: 1080 });
});

test('横图按最长边等比缩放', () => {
  const r = scaledImageSize(4000, 3000);
  assert.equal(Math.max(r.width, r.height), MAX_IMAGE_DIM);
  assert.equal(r.width, 1920);
  assert.equal(r.height, 1440);
});

test('竖图按最长边等比缩放', () => {
  const r = scaledImageSize(3000, 4000);
  assert.equal(r.width, 1440);
  assert.equal(r.height, 1920);
});


test('极端长宽比不会产生 0 尺寸', () => {
  const r = scaledImageSize(8000, 5);
  assert.equal(r.width, MAX_IMAGE_DIM);
  assert.ok(r.height >= 1, '短边至少 1px，否则 Canvas 构造失败');
});

test('非正尺寸兜底为 1x1', () => {
  assert.deepEqual(scaledImageSize(0, 100), { width: 1, height: 1 });
  assert.deepEqual(scaledImageSize(-5, -5), { width: 1, height: 1 });
});

test('自定义上限生效（缩略图等场景可复用）', () => {
  assert.deepEqual(scaledImageSize(2000, 1000, 400), { width: 400, height: 200 });
});

test('sanitizeMediaFileName：空白与非法字符清洗，短名兜底', () => {
  assert.equal(sanitizeMediaFileName('my photo.jpg'), 'my-photo');
  assert.equal(sanitizeMediaFileName('  你好 world!.png '), '你好-world');
  assert.equal(sanitizeMediaFileName('---'), 'file');
});

test('extForFormat：格式到扩展名，未知格式兜底 bin', () => {
  assert.equal(extForFormat('jpeg'), 'jpg');
  assert.equal(extForFormat('webp'), 'webp');
  assert.equal(extForFormat('mp4'), 'mp4');
  assert.equal(extForFormat('unknown-thing'), 'bin');
});

test('thumbnailPathFor：保留目录前缀，扩展名换 webp', () => {
  assert.equal(thumbnailPathFor('2026/10/abc.jpg'), '2026/10/thumb-abc.webp');
  assert.equal(thumbnailPathFor('abc.png'), 'thumb-abc.webp');
});

test('isDerivedAsset：识别缩略图前缀', () => {
  assert.equal(isDerivedAsset('thumb-abc.webp'), true);
  assert.equal(isDerivedAsset('abc.webp'), false);
});
