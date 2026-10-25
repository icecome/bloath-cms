// isPrivateOrBlockedHost 单测：SSRF 守卫的地址分类锁定（audit P2-33）。
// 运行：node --experimental-strip-types --test src/services/s3.errors.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrBlockedHost, isBlockedS3Endpoint } from './s3.errors.ts';

describe('isPrivateOrBlockedHost（IPv4/主机名，既有语义回归）', () => {
  it('拦截 localhost / 0.0.0.0 / 127.x / 10.x / 192.168.x / 172.16-31.x / 169.254.x / 100.64-127.x', () => {
    for (const h of ['localhost', '0.0.0.0', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '100.127.255.255']) {
      assert.equal(isPrivateOrBlockedHost(h), true, h);
    }
  });
  it('放行公网 IPv4 与正常域名', () => {
    for (const h of ['8.8.8.8', '1.2.3.4', 's3.example.com', 'xxx.r2.cloudflarestorage.com', '172.32.0.1', '100.128.0.1']) {
      assert.equal(isPrivateOrBlockedHost(h), false, h);
    }
  });
  it('拦截 .internal / .local', () => {
    assert.equal(isPrivateOrBlockedHost('minio.internal'), true);
    assert.equal(isPrivateOrBlockedHost('nas.local'), true);
  });
});

describe('isPrivateOrBlockedHost（IPv6，P2-33 补齐）', () => {
  it('拦截 ::1 与 ::（未指定地址）', () => {
    assert.equal(isPrivateOrBlockedHost('::1'), true);
    assert.equal(isPrivateOrBlockedHost('::'), true);
  });
  it('拦截 ULA fc00::/7（fc/fd 开头）', () => {
    for (const h of ['fc00::1', 'fd12:3456:789a::1', 'FDBE:1::abc']) {
      assert.equal(isPrivateOrBlockedHost(h), true, h);
    }
  });
  it('拦截链路本地 fe80::/10（fe8-feb 开头）', () => {
    for (const h of ['fe80::1', 'fe90::abcd', 'fea0::1', 'febf::ff']) {
      assert.equal(isPrivateOrBlockedHost(h), true, h);
    }
  });
  it('拦截 ::ffff: 映射的私网 IPv4', () => {
    for (const h of ['::ffff:127.0.0.1', '::ffff:10.0.0.5', '::ffff:192.168.1.1']) {
      assert.equal(isPrivateOrBlockedHost(h), true, h);
    }
  });
  it('放行公网 IPv6 字面量', () => {
    for (const h of ['2606:4700::1', '2400:cb00::1', 'fe00::1']) {
      assert.equal(isPrivateOrBlockedHost(h), false, h);
    }
  });
  it('带方括号的 IPv6 同样判定（URL hostname 会剥 []，防御性保留）', () => {
    assert.equal(isPrivateOrBlockedHost('[fd00::1]'), true);
  });
});

describe('isBlockedS3Endpoint', () => {
  it('拦截私网端点', () => {
    assert.equal(isBlockedS3Endpoint('http://127.0.0.1:9000'), true);
    assert.equal(isBlockedS3Endpoint('http://[fd00::1]:9000'), true);
    assert.equal(isBlockedS3Endpoint('ftp://s3.example.com'), true);
    assert.equal(isBlockedS3Endpoint('not a url'), true);
  });
  it('放行公网端点', () => {
    assert.equal(isBlockedS3Endpoint('https://s3.example.com'), false);
    assert.equal(isBlockedS3Endpoint('https://account.r2.cloudflarestorage.com'), false);
  });
});
