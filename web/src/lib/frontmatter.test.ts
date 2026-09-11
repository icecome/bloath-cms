import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFrontmatter } from './frontmatter.ts';
import type { Frontmatter } from './frontmatter.ts';

function yamlKeys(block: string): string[] {
  return block
    .split('\n')
    .filter((line) => /^[A-Za-z_][\w-]*:/.test(line))
    .map((line) => line.split(':')[0]);
}

test('generateFrontmatter orders keys: title, time, author, slug, categories, tags, others', () => {
  const fm: Frontmatter = {
    tags: ['b', 'a'],
    cover: 'https://example.com/cover.png',
    author: 'alice',
    title: 'Hello',
    categories: ['tech'],
    lastmod: '2026-01-02T10:00:00+08:00',
    date: '2026-01-01T09:00:00+08:00',
    url: '20260101-hello',
    weight: 3
  };

  const text = generateFrontmatter(fm, { format: 'yaml', slugFromUrl: true });
  const keys = yamlKeys(text);

  assert.deepEqual(keys, [
    'title',
    'date',
    'lastmod',
    'author',
    'slug',
    'categories',
    'tags',
    'cover',
    'weight'
  ]);
});

test('generateFrontmatter keeps original relative order among other fields', () => {
  const fm = {
    weight: 1,
    cover: 'c.png',
    description: 'desc',
    title: 'T'
  } as Frontmatter;

  const keys = yamlKeys(generateFrontmatter(fm, { format: 'yaml' }));
  assert.deepEqual(keys, ['title', 'weight', 'cover', 'description']);
});

test('generateFrontmatter honours taxonomyWrapper with categories before tags in block', () => {
  const fm: Frontmatter = {
    tags: ['x'],
    title: 'T',
    categories: ['y'],
    date: '2026-01-01T00:00:00+08:00',
    slug: 't'
  };

  const text = generateFrontmatter(fm, {
    format: 'yaml',
    taxonomyWrapper: 'taxonomies'
  });

  assert.match(text, /title: T/);
  assert.match(text, /taxonomies:/);
  const taxBlock = text.slice(text.indexOf('taxonomies:'));
  const taxLines = taxBlock.split('\n').filter((l) => /^\s{2}(categories|tags):/.test(l));
  assert.deepEqual(
    taxLines.map((l) => l.trim().split(':')[0]),
    ['categories', 'tags']
  );
});

test('generateFrontmatter TOML also applies preferred key order', () => {
  const fm: Frontmatter = {
    tags: ['t1'],
    title: 'Hello',
    author: 'bob',
    date: '2026-02-01T12:00:00+08:00',
    url: 'hello-toml'
  };

  const text = generateFrontmatter(fm, { format: 'toml', slugFromUrl: true });
  const keys = text
    .split('\n')
    .filter((line) => /^[A-Za-z_][\w-]*\s*=/.test(line))
    .map((line) => line.split('=')[0].trim());

  assert.deepEqual(keys, ['title', 'date', 'author', 'slug', 'tags']);
});

test('generateFrontmatter omits empty and forbidden url field', () => {
  const fm: Frontmatter = {
    url: 'should-not-appear',
    title: 'Keep',
    author: ''
  };

  const text = generateFrontmatter(fm, { format: 'yaml', slugFromUrl: false });
  assert.deepEqual(yamlKeys(text), ['title']);
  assert.ok(!text.includes('url'));
  assert.ok(!text.includes('author'));
});
