// 体积上限的 worker 侧契约（与 web/src/lib/mediaLimits.test.ts 互为镜像）。
//
// 本文件断言的是 **pathGuard.ts 里的真实常量**与前端常量的关系——不是副本。
// 前端那份测试只能用字面量副本（前端无法 import worker 模块），所以真正能
// 发现「某天有人改了 worker 常量」的只有这一份。
//
// 【为什么放在 services/】CI 历史上只跑 `src/services/*.test.ts`。2026-11-12 起
// workflow 扩到 lib 与 middleware，但把契约测试留在 services 可保证它在任何
// 配置下都会被跑到——这条断言失效的代价是「前端放行、服务端 400」重现。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CONTENT_SIZE,
  MAX_JSON_BODY_SIZE,
  MAX_MEDIA_BINARY_SIZE,
} from '../middleware/pathGuard.ts';

/**
 * 前端上限（与 web/src/lib/mediaLimits.ts 一致）。
 * 改动任一侧时两侧注释与这两个常量必须同步，否则本契约测试会失败。
 */
const WEB_IMAGE_ORIGINAL_MAX_BYTES = 14 * 1024 * 1024;
const WEB_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const WEB_VIDEO_MAX_BYTES_GITHUB = 25 * 1024 * 1024;

/** base64 膨胀后的长度（前端 mediaLimits.estimateBase64Length 的同式） */
function estimateBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

describe('worker 体积上限 / 与前端自洽', () => {
  test('前端原图上限 base64 后不超过 MAX_CONTENT_SIZE', () => {
    const base64 = estimateBase64Length(WEB_IMAGE_ORIGINAL_MAX_BYTES);
    assert.ok(
      base64 <= MAX_CONTENT_SIZE,
      `前端原图 ${WEB_IMAGE_ORIGINAL_MAX_BYTES} 字节 → base64 ${base64}，`
      + `超过 worker MAX_CONTENT_SIZE ${MAX_CONTENT_SIZE}。`
      + '调整任一侧常量时必须同时调整另一侧，否则前端放行、服务端 400。'
    );
  });

  test('前端压缩模式源上限 base64 后仍在 JSON 体上限内', () => {
    const base64 = estimateBase64Length(WEB_IMAGE_MAX_SOURCE_BYTES);
    assert.ok(base64 <= MAX_JSON_BODY_SIZE);
  });

  test('媒体二进制端点上限覆盖 JSON 端点可承载的二进制量', () => {
    const effectiveBinaryViaJson = Math.floor(MAX_CONTENT_SIZE * 3 / 4);
    assert.ok(
      MAX_MEDIA_BINARY_SIZE >= effectiveBinaryViaJson,
      `二进制端点 ${MAX_MEDIA_BINARY_SIZE} 小于 JSON 端点有效二进制上限 ${effectiveBinaryViaJson}，`
      + '同一文件走两条通道会得到两种结果'
    );
  });

  test('前端 GitHub 通道视频上限 base64 后不超过 JSON 体上限', () => {
    const base64 = estimateBase64Length(WEB_VIDEO_MAX_BYTES_GITHUB);
    assert.ok(
      base64 <= MAX_JSON_BODY_SIZE,
      `视频 ${WEB_VIDEO_MAX_BYTES_GITHUB} 字节 → base64 ${base64}，超过 JSON 体上限 ${MAX_JSON_BODY_SIZE}`
    );
  });

  test('三个上限的相对关系稳定（content < json，binary > content 的有效二进制量）', () => {
    assert.ok(MAX_CONTENT_SIZE < MAX_JSON_BODY_SIZE, 'JSON 外壳必须比内容本身更宽');
    assert.ok(MAX_MEDIA_BINARY_SIZE > Math.floor(MAX_CONTENT_SIZE * 3 / 4));
  });
});

describe('worker 体积上限 / 数值形态', () => {
  test('均为正整数且是 MiB 整倍数（避免出现难解释的奇数上限）', () => {
    for (const [name, value] of Object.entries({
      MAX_CONTENT_SIZE, MAX_JSON_BODY_SIZE, MAX_MEDIA_BINARY_SIZE,
    })) {
      assert.ok(Number.isInteger(value), `${name} 必须是整数`);
      assert.ok(value > 0, `${name} 必须为正`);
      assert.equal(value % (1024 * 1024), 0, `${name} 应为 MiB 整倍数，实际 ${value}`);
    }
  });
});
