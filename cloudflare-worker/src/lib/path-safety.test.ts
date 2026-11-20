// path-safety 语义锁（零依赖校验模块，2026-11-12 从 middleware/pathGuard 迁出）。
//
// 这段逻辑是路径穿越与原型污染的第一道闸门，改动代价远大于写测试的成本。
// 迁出到 lib/ 的直接目的就是让它可被 node 测试链路加载——migrate 前它藏在
// middleware 里，而 CI 当时只跑 services 测试，等于完全没有门禁。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSafePathParam } from './path-safety.ts';

describe('isSafePathParam / 拒绝形态', () => {
  test('空值一律拒绝（null / undefined / 空串）', () => {
    assert.equal(isSafePathParam(null), false);
    assert.equal(isSafePathParam(undefined), false);
    assert.equal(isSafePathParam(''), false);
  });

  test('路径穿越被拒绝（含 .. 任意位置）', () => {
    assert.equal(isSafePathParam('..'), false);
    assert.equal(isSafePathParam('../etc/passwd'), false);
    assert.equal(isSafePathParam('a/../../b'), false);
    assert.equal(isSafePathParam('a..b'), false);
    assert.equal(isSafePathParam('../etc/passwd', true), false, 'allowSlash 不得放行穿越');
  });

  test('NUL 字节被拒绝', () => {
    assert.equal(isSafePathParam('a\0b'), false);
    assert.equal(isSafePathParam('a\0b', true), false);
  });

  test('路径分隔符在 allowSlash=false 时被拒绝', () => {
    assert.equal(isSafePathParam('a/b'), false);
    assert.equal(isSafePathParam('a/b', true), true, 'allowSlash=true 时放行');
  });

  test('空白与特殊字符被拒绝（空格 / 反斜杠 / 冒号 / 星号）', () => {
    assert.equal(isSafePathParam('a b'), false);
    assert.equal(isSafePathParam('a\\b'), false);
    assert.equal(isSafePathParam('C:foo'), false);
    assert.equal(isSafePathParam('*'), false);
    assert.equal(isSafePathParam('a?b'), false);
  });
});

describe('isSafePathParam / 放行形态', () => {
  test('普通文件名', () => {
    assert.equal(isSafePathParam('index.md'), true);
    assert.equal(isSafePathParam('a-b_c.d'), true);
  });

  test('中文文件名（CJK 基本区）', () => {
    assert.equal(isSafePathParam('文章标题.md'), true);
    assert.equal(isSafePathParam('动态照片.jpg'), true);
  });

  test('多段 object key（allowSlash=true）', () => {
    assert.equal(isSafePathParam('assets/2026/11/a.webp', true), true);
    assert.equal(isSafePathParam('media/motion/1.jpg', true), true);
  });

  test('前导斜杠在 allowSlash=true 时通过校验（由调用方去前导斜杠）', () => {
    // parseMediaFileRequest 的做法：先 replace(/^\/+/, '') 再校验；
    // 这里锁定「校验本身不负责裁剪」的边界
    assert.equal(isSafePathParam('/assets/a.webp', true), true);
  });

  test('点号开头（隐藏目录）通过：由内容路径配置决定是否使用，不属路径安全范畴', () => {
    assert.equal(isSafePathParam('.draft', true), true);
    assert.equal(isSafePathParam('.trash/a.md', true), true);
  });
});

describe('isSafePathParam / 类型守卫语义', () => {
  test('返回 true 时类型收窄为非空 string（调用方不必二次判空）', () => {
    const value: string | null = Math.random() > -1 ? 'a.md' : null;
    if (isSafePathParam(value)) {
      // 编译期校验：此处 value 应为 string
      const length: number = value.length;
      assert.equal(length, 4);
    } else {
      assert.fail('合法值不应被拒绝');
    }
  });
});
