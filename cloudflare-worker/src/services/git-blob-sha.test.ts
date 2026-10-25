// git blob sha 单测：用固定向量锁定算法（与 git hash-object 语义一致）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gitBlobSha } from './git-blob-sha.ts';

// 固定向量：`printf 'hello world\n' | git hash-object --stdin`
// → 3b18e512dba79e4c8300dd08aeb37f8e728b8dad（12 字节；已用 git hash-object
//   与 node crypto 双重交叉验证。ce0136... 是无换行 "hello world" 的 sha，勿混用）
const KNOWN_SHA = '3b18e512dba79e4c8300dd08aeb37f8e728b8dad';

describe('gitBlobSha', () => {
  it('空内容（blob 4\\0）→ e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', async () => {
    assert.equal(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
  it('"hello world\\n" 与 git hash-object 一致', async () => {
    assert.equal(await gitBlobSha('hello world\n'), KNOWN_SHA);
  });
  it('同样内容两次计算结果一致；不同内容不同', async () => {
    const a = await gitBlobSha('测试内容\n中文');
    const b = await gitBlobSha('测试内容\n中文');
    assert.equal(a, b);
    assert.notEqual(a, await gitBlobSha('测试内容\n中文 '));
  });
  it('多字节字符按 UTF-8 字节数计长（非字符数）', async () => {
    // '中' 是 3 字节：blob 3\0中 —— 若按字符数计长（1）结果会不同
    const sha = await gitBlobSha('中');
    assert.match(sha, /^[0-9a-f]{40}$/);
    // 与 node 原生 crypto 交叉验证
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha1').update(Buffer.from('blob 3\0中', 'utf8')).digest('hex');
    assert.equal(sha, expected);
  });
});
