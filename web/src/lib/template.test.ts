// 统一模板引擎单元测试
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, migrateLegacyTemplate, fillPathTemplate } from './template.ts';

const fixedNow = new Date(2026, 9, 22, 14, 5, 9); // 2026-10-22 14:05:09

describe('fillTemplate（日期标签）', () => {
  it('YYYY/MM/DD/HH/mm/SS 各段正确', () => {
    const out = fillTemplate('{{date:YYYY}}-{{date:MM}}-{{date:DD}} {{date:HH}}:{{date:mm}}:{{date:SS}}', { now: fixedNow });
    assert.equal(out, '2026-10-22 14:05:09');
  });

  it('YYYYMMDD 紧凑日期', () => {
    assert.equal(fillTemplate('{{date:YYYYMMDD}}', { now: fixedNow }), '20261022');
  });
});

describe('fillTemplate（文件名与随机串）', () => {
  it('filename 去扩展名', () => {
    assert.equal(fillTemplate('{{filename}}.webp', { filename: 'hello world.png', now: fixedNow }), 'hello world.webp');
  });

  it('无 filename 时回退 image', () => {
    assert.equal(fillTemplate('{{filename}}', { now: fixedNow }), 'image');
  });

  it('random:N 输出指定长度的小写字母数字', () => {
    const out = fillTemplate('{{random:8}}', { now: fixedNow });
    assert.equal(out.length, 8);
    assert.match(out, /^[a-z0-9]{8}$/);
  });

  it('未知标签保留原样', () => {
    assert.equal(fillTemplate('{{what}}', { now: fixedNow }), '{{what}}');
  });
});

describe('fillTemplate（字段引用）', () => {
  it('fields.<name> 取值', () => {
    assert.equal(fillTemplate('{{fields.title}}', { fields: { title: 'hello' }, now: fixedNow }), 'hello');
  });

  it('字段缺失输出空串（不留占位符）', () => {
    assert.equal(fillTemplate('a-{{fields.missing}}-b', { fields: {}, now: fixedNow }), 'a--b');
  });
});

describe('migrateLegacyTemplate（旧语法迁移）', () => {
  it('默认媒体模板完整映射', () => {
    const legacy = '{Y}{m}{d}{h}{i}{s}-{filename}-{str-8}-{str-5}';
    const migrated = migrateLegacyTemplate(legacy);
    assert.equal(
      migrated,
      '{{date:YYYY}}{{date:MM}}{{date:DD}}{{date:HH}}{{date:mm}}{{date:SS}}-{{filename}}-{{random:8}}-{{random:5}}'
    );
  });

  it('新语法幂等（含 {{ 直接返回）', () => {
    assert.equal(migrateLegacyTemplate('{{date:YYYY}}'), '{{date:YYYY}}');
  });

  it('未知旧占位符原样保留', () => {
    assert.equal(migrateLegacyTemplate('{custom}'), '{custom}');
  });

  it('迁移后 fillTemplate 可正确填充', () => {
    const migrated = migrateLegacyTemplate('{Y}{m}{d}-{filename}');
    const out = fillTemplate(migrated, { filename: 'photo.jpg', now: fixedNow });
    assert.equal(out, '20261022-photo');
  });
});

describe('fillPathTemplate（mediaPath 模板化）', () => {
  it('按月归档路径', () => {
    assert.equal(fillPathTemplate('assets/{{date:YYYY}}/{{date:MM}}', { now: fixedNow }), 'assets/2026/10');
  });

  it('清洗空段与相对段（防路径穿越）', () => {
    assert.equal(fillPathTemplate('assets/{{date:YYYY}}//{{date:MM}}/../..', { now: fixedNow }), 'assets/2026/10');
  });

  it('纯静态路径原样（去首尾斜杠）', () => {
    assert.equal(fillPathTemplate('/assets/images/', { now: fixedNow }), 'assets/images');
  });
});
