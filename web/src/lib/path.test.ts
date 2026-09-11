import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatterDate,
  buildFrontmatterSlug,
  resolveExistingSlug,
  cleanTitleForFilename,
  sanitizeSlugCore,
  buildArticleFilename
} from './path.ts';

test('parseFrontmatterDate handles Date instances', () => {
  const d = new Date('2024-10-18T12:34:56');
  const fallback = new Date('2000-01-01T00:00:00');
  assert.equal(parseFrontmatterDate(d, fallback).getTime(), d.getTime());
});

test('parseFrontmatterDate handles ISO strings', () => {
  const fallback = new Date('2000-01-01T00:00:00');
  const parsed = parseFrontmatterDate('2024-10-18T12:34:56+08:00', fallback);
  assert.equal(parsed.getFullYear(), 2024);
  assert.notEqual(parsed.getTime(), fallback.getTime());
});

test('parseFrontmatterDate falls back on invalid input', () => {
  const fallback = new Date('2000-01-01T00:00:00');
  assert.equal(parseFrontmatterDate(null, fallback), fallback);
  assert.equal(parseFrontmatterDate('not-a-date', fallback), fallback);
  assert.equal(parseFrontmatterDate(new Date('invalid'), fallback), fallback);
});

test('buildFrontmatterSlug uses core word when present', () => {
  const day = new Date(2026, 7, 9, 20, 15, 30);
  assert.equal(buildFrontmatterSlug(day, 'qyxj'), '20260809-qyxj');
});

test('buildFrontmatterSlug empty core uses wall-clock time, not article midnight', () => {
  const articleMidnight = new Date(2026, 7, 9, 0, 0, 0);
  const wall = new Date(2026, 7, 9, 14, 30, 5);
  assert.equal(
    buildFrontmatterSlug(articleMidnight, '', wall),
    '20260809-143005'
  );
});

test('buildFrontmatterSlug strips pasted date prefix', () => {
  const day = new Date(2026, 7, 9, 1, 0, 0);
  assert.equal(buildFrontmatterSlug(day, '20260809-qyxj'), '20260809-qyxj');
});

test('sanitizeSlugCore drops non-ascii and returns empty for Chinese', () => {
  assert.equal(sanitizeSlugCore('努力克服自卑的我们'), '');
  assert.equal(sanitizeSlugCore('QY-XJ'), 'qy-xj');
});

test('resolveExistingSlug returns null without core', () => {
  const day = new Date(2026, 7, 9, 1, 0, 0);
  assert.equal(resolveExistingSlug(day, ''), null);
  assert.equal(resolveExistingSlug(day, '  '), null);
  assert.equal(resolveExistingSlug(day, 'cms'), '20260809-cms');
});

test('cleanTitleForFilename strips punctuation and Windows-illegal chars', () => {
  assert.equal(
    cleanTitleForFilename('七月小结：缭乱的思绪和进击的项目'),
    '七月小结-缭乱的思绪和进击的项目'
  );
  assert.equal(cleanTitleForFilename('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  assert.equal(cleanTitleForFilename(''), '未命名');
});

test('buildArticleFilename combines date and cleaned title', () => {
  const day = new Date(2026, 7, 9, 0, 0, 0);
  assert.equal(
    buildArticleFilename(day, '入夏的雨'),
    '20260809-入夏的雨.md'
  );
});
