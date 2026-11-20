// 体积上限的跨端交叉校验（web ↔ worker 常量必须在数值上自洽）。
//
// 【为什么需要这份测试】两侧常量无法共享源码（前端读 import.meta.env、worker 在
// 独立 tsconfig 下编译），只能各自维护。历史事故正是「各写各的」：
//   web/src/lib/mediaUtils.ts  MAX_FILE_SIZE = 20 MB（源文件）
//   worker pathGuard.ts        MAX_CONTENT_SIZE = 10 MB（**base64 字符串**长度）
// 症状是「前端放行、服务端 400」，用户传了 15 MB 原图，前端说没问题，服务端拒绝。
//
// 【本文件锁的三条不变量】
// 1. base64 膨胀后仍不超过 worker 的 MAX_CONTENT_SIZE —— 否则前端放行、服务端 400。
// 2. 二进制端点上限不低于 base64 端点的有效二进制上限 —— 否则同一文件走两条通道
//    得到两种结果（二进制通道能传、JSON 通道不能）。
// 3. JSON 请求体上限覆盖 media base64 + 其它字段 —— 否则真正的瓶颈出现在 JSON 外壳。
//
// worker 常量在此以**字面量副本**出现。它们与
// cloudflare-worker/src/middleware/pathGuard.ts 的一致性由 worker 侧的同名测试
// （cloudflare-worker/src/services/mediaLimits.contract.test.ts）反向锁定。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_MAX_SOURCE_BYTES,
  IMAGE_ORIGINAL_MAX_BYTES,
  VIDEO_MAX_BYTES_GITHUB,
  VIDEO_MAX_BYTES_S3,
  estimateBase64Length,
  formatMegabytes,
  videoMaxBytes,
} from './mediaLimits.ts';

/** 与 cloudflare-worker/src/middleware/pathGuard.ts 保持一致（改任一侧必须同步本注释与断言） */
const WORKER_MAX_CONTENT_SIZE = 20 * 1024 * 1024;   // base64 字符串长度
const WORKER_MAX_JSON_BODY_SIZE = 40 * 1024 * 1024; // JSON 文本长度
const WORKER_MAX_MEDIA_BINARY_SIZE = 25 * 1024 * 1024; // 原始字节

describe('体积上限 / 跨端自洽', () => {
  test('原图模式 base64 后不超过 worker MAX_CONTENT_SIZE（否则前端放行、服务端 400）', () => {
    const base64Length = estimateBase64Length(IMAGE_ORIGINAL_MAX_BYTES);
    assert.ok(
      base64Length <= WORKER_MAX_CONTENT_SIZE,
      `原图 ${formatMegabytes(IMAGE_ORIGINAL_MAX_BYTES)} → base64 ${base64Length} 字节，`
      + `超过 worker 上限 ${WORKER_MAX_CONTENT_SIZE}。用户会在上传完成后才收到 400。`
    );
  });

  test('二进制通道上限不低于 base64 通道的有效二进制上限', () => {
    const effectiveBinaryViaJson = Math.floor(WORKER_MAX_CONTENT_SIZE * 3 / 4);
    assert.ok(
      WORKER_MAX_MEDIA_BINARY_SIZE >= effectiveBinaryViaJson,
      `二进制端点 ${formatMegabytes(WORKER_MAX_MEDIA_BINARY_SIZE)} 小于 JSON 端点可承载的 `
      + `${formatMegabytes(effectiveBinaryViaJson)}，同一文件走两条通道会得到两种结果`
    );
  });

  test('JSON 请求体上限覆盖最大 base64 载荷（含字段与转义余量）', () => {
    const maxBase64 = estimateBase64Length(Math.max(IMAGE_MAX_SOURCE_BYTES, VIDEO_MAX_BYTES_GITHUB));
    assert.ok(
      WORKER_MAX_JSON_BODY_SIZE > WORKER_MAX_CONTENT_SIZE,
      'JSON 外壳必须比内容本身更宽（含 owner/repo/path 等字段与转义）'
    );
    assert.ok(
      maxBase64 <= WORKER_MAX_JSON_BODY_SIZE,
      `最大 base64 载荷 ${maxBase64} 超过 JSON 体上限 ${WORKER_MAX_JSON_BODY_SIZE}`
    );
  });

  test('压缩模式源文件上限 ≥ 原图模式（否则「压缩模式更严格」是反直觉的）', () => {
    assert.ok(IMAGE_MAX_SOURCE_BYTES >= IMAGE_ORIGINAL_MAX_BYTES);
  });

  test('S3 通道视频上限 > GitHub 通道（S3 不经 Worker，不受子请求限制）', () => {
    assert.ok(VIDEO_MAX_BYTES_S3 > VIDEO_MAX_BYTES_GITHUB);
  });
});

describe('estimateBase64Length', () => {
  test('按 4/3 向上取整（每 3 字节 → 4 字符）', () => {
    assert.equal(estimateBase64Length(0), 0);
    assert.equal(estimateBase64Length(1), 4);
    assert.equal(estimateBase64Length(3), 4);
    assert.equal(estimateBase64Length(4), 8);
    assert.equal(estimateBase64Length(6), 8);
  });

  test('不与真实编码长度矛盾（对若干字节数验证上界）', () => {
    for (const bytes of [1, 2, 3, 4, 5, 100, 1024, 1025, 65535]) {
      const estimated = estimateBase64Length(bytes);
      const actual = Math.ceil(bytes / 3) * 4;
      assert.equal(estimated, actual, `${bytes} 字节的 base64 长度估算不一致`);
      assert.ok(estimated >= bytes, 'base64 一定比原文长');
    }
  });
});

describe('formatMegabytes', () => {
  test('整数 MB 不带小数位', () => {
    assert.equal(formatMegabytes(20 * 1024 * 1024), '20 MB');
    assert.equal(formatMegabytes(25 * 1024 * 1024), '25 MB');
  });

  test('非整数保留一位小数', () => {
    assert.equal(formatMegabytes(14 * 1024 * 1024), '14 MB');
    assert.equal(formatMegabytes(1.5 * 1024 * 1024), '1.5 MB');
  });

  test('中文语境留白：数字与 MB 之间有半角空格', () => {
    assert.match(formatMegabytes(20 * 1024 * 1024), /^\d+(\.\d)? MB$/);
  });
});

describe('videoMaxBytes', () => {
  test('按后端选上限', () => {
    assert.equal(videoMaxBytes(true), VIDEO_MAX_BYTES_S3);
    assert.equal(videoMaxBytes(false), VIDEO_MAX_BYTES_GITHUB);
  });
});
