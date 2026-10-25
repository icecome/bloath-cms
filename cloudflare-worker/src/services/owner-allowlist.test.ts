// 所有者白名单单测：锁定 fail-closed 三态语义（允许/拒绝/未配置）。
// 运行：node --experimental-strip-types --test src/services/owner-allowlist.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLoginAllowed, parseAllowlist } from './owner-allowlist.ts';

describe('parseAllowlist', () => {
  it('逗号分隔解析并统一小写、去空项', () => {
    assert.deepEqual(parseAllowlist(' Alice ,BOB,, Charlie '), ['alice', 'bob', 'charlie']);
  });
  it('undefined/空串返回空数组', () => {
    assert.deepEqual(parseAllowlist(undefined), []);
    assert.deepEqual(parseAllowlist(''), []);
    assert.deepEqual(parseAllowlist('  ,  '), []);
  });
});

describe('isLoginAllowed（fail-closed 三态）', () => {
  const prod = (raw?: string) => ({ ADMIN_GITHUB_LOGIN: raw, ENVIRONMENT: 'production' });
  const dev = (raw?: string) => ({ ADMIN_GITHUB_LOGIN: raw, ENVIRONMENT: 'development' });

  it('白名单命中（大小写不敏感、含首尾空白）放行', () => {
    assert.equal(isLoginAllowed('Alice', prod('alice')), true);
    assert.equal(isLoginAllowed('  BOB ', prod('alice,bob')), true);
  });
  it('白名单未命中拒绝', () => {
    assert.equal(isLoginAllowed('eve', prod('alice,bob')), false);
  });
  it('生产环境未配置白名单：拒绝所有 OAuth 登录', () => {
    assert.equal(isLoginAllowed('alice', prod(undefined)), false);
    assert.equal(isLoginAllowed('alice', prod('')), false);
    assert.equal(isLoginAllowed('alice', prod('  ')), false);
  });
  it('非生产环境未配置白名单：放行（本地开发依赖随机账号调试）', () => {
    assert.equal(isLoginAllowed('anyone', dev(undefined)), true);
  });
  it('非生产环境配置了白名单：同样生效', () => {
    assert.equal(isLoginAllowed('eve', dev('alice')), false);
    assert.equal(isLoginAllowed('alice', dev('alice')), true);
  });
});
