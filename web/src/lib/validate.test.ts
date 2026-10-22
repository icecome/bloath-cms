// 字段校验单元测试（P2-4）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateFieldValue, clampText } from './validate.ts';
import type { FieldConfig } from '../../../shared/types';

function field(over: Partial<FieldConfig>): FieldConfig {
  return { name: 'f', label: '字段', type: 'string', ...over };
}

describe('validateFieldValue', () => {
  it('空值不触发 pattern 校验', () => {
    const f = field({ type: 'url', pattern: '^https?://' });
    assert.equal(validateFieldValue(f, undefined), null);
    assert.equal(validateFieldValue(f, ''), null);
  });

  it('pattern 完整匹配通过', () => {
    const f = field({ type: 'url', pattern: '^https?://.+' });
    assert.equal(validateFieldValue(f, 'https://example.com'), null);
  });

  it('pattern 部分匹配不算通过（完整匹配语义）', () => {
    const f = field({ type: 'url', pattern: 'https://' });
    assert.ok(validateFieldValue(f, 'xhttps://y'));
  });

  it('patternMessage 自定义文案', () => {
    const f = field({ type: 'slug', pattern: '^[a-z0-9-]+$', patternMessage: '仅小写字母' });
    assert.equal(validateFieldValue(f, 'ABC'), '仅小写字母');
  });

  it('pattern 非法正则不阻断（返回 null）', () => {
    const f = field({ type: 'string', pattern: '([bad' });
    assert.equal(validateFieldValue(f, 'any'), null);
  });

  it('min/max：number 越界报错', () => {
    const f = field({ type: 'number', min: 1, max: 10 });
    assert.equal(validateFieldValue(f, 0), '字段不能小于 1');
    assert.equal(validateFieldValue(f, 11), '字段不能大于 10');
    assert.equal(validateFieldValue(f, 5), null);
  });

  it('min/max 不作用于非 number 类型', () => {
    const f = field({ type: 'string', min: 5 });
    assert.equal(validateFieldValue(f, 'abc'), null);
  });

  it('string 值传给 number 字段（类型不符）不崩溃', () => {
    const f = field({ type: 'number', min: 1 });
    assert.equal(validateFieldValue(f, 'not-a-number'), null);
  });
});

describe('clampText（maxLength 裁剪）', () => {
  it('超长截断', () => {
    const f = field({ type: 'string', maxLength: 5 });
    assert.equal(clampText('abcdefgh', f), 'abcde');
  });

  it('未超长原样返回', () => {
    const f = field({ type: 'string', maxLength: 10 });
    assert.equal(clampText('abc', f), 'abc');
  });

  it('maxLength 未配置不裁剪', () => {
    const f = field({ type: 'string' });
    assert.equal(clampText('a'.repeat(100), f), 'a'.repeat(100));
  });

  it('非文本类型不裁剪', () => {
    const f = field({ type: 'datetime', maxLength: 2 });
    assert.equal(clampText('2026-01-01', f), '2026-01-01');
  });
});
