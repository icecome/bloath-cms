// 上传计划层单元测试：格式 → 类型 → 模式 → 扩展名 → 上限的决策矩阵。
// 这是「压缩/原图 + 视频」的全部策略判断所在，用构造的魔数头覆盖，不依赖真实媒体文件。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planUpload, UploadRejected, shouldCompress } from './mediaUploadPlan.ts';
import {
  IMAGE_MAX_SOURCE_BYTES, IMAGE_ORIGINAL_MAX_BYTES,
  VIDEO_MAX_BYTES_GITHUB, VIDEO_MAX_BYTES_S3,
} from './mediaLimits.ts';
import { sanitizeMediaFileName, extForFormat, videoEmbedSnippet } from './mediaUtils.ts';

/** 构造带指定头部字节的假文件 */
function makeFile(name: string, bytes: number[], size?: number): File {
  const head = new Uint8Array(bytes);
  const total = size ?? head.length;
  const blob = new Blob([head]);
  const file = new File([blob], name);
  // File 的 size 只读：用 defineProperty 伪造体积，避免真的分配几十 MB
  Object.defineProperty(file, 'size', { value: total });
  return file;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47];
const GIF = [0x47, 0x49, 0x46, 0x38];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const SVG_TEXT = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

/** ftyp + major brand（offset 4 起 8 字节） */
function ftyp(brand: string): number[] {
  return [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, ...new TextEncoder().encode(brand.padEnd(4, ' '))];
}

describe('planUpload —— 图片模式', () => {
  it('JPEG + 压缩 → webp', async () => {
    const plan = await planUpload(makeFile('a.jpg', JPEG), 'compress', { isS3: false });
    assert.equal(plan.kind, 'image');
    assert.equal(plan.mode, 'compress');
    assert.equal(plan.ext, 'webp');
    assert.equal(shouldCompress(plan), true);
  });

  it('JPEG + 原图 → jpg，不做重编码', async () => {
    const plan = await planUpload(makeFile('a.jpg', JPEG), 'original', { isS3: false });
    assert.equal(plan.mode, 'original');
    assert.equal(plan.ext, 'jpg');
    assert.equal(shouldCompress(plan), false);
  });

  it('PNG + 原图 → png', async () => {
    const plan = await planUpload(makeFile('a.png', PNG), 'original', { isS3: false });
    assert.equal(plan.ext, 'png');
  });

  it('GIF 在压缩模式下强制原图并给出原因', async () => {
    const plan = await planUpload(makeFile('a.gif', GIF), 'compress', { isS3: false });
    assert.equal(plan.mode, 'original');
    assert.equal(plan.ext, 'gif');
    assert.ok(plan.modeReason && plan.modeReason.includes('动画'));
  });

  it('SVG 在压缩模式下强制原图', async () => {
    const plan = await planUpload(makeFile('a.svg', Array.from(SVG_TEXT)), 'compress', { isS3: false });
    assert.equal(plan.mode, 'original');
    assert.equal(plan.ext, 'svg');
    assert.ok(plan.modeReason && plan.modeReason.includes('矢量'));
  });

  it('WebP 原图保持 webp', async () => {
    const plan = await planUpload(makeFile('a.webp', WEBP), 'original', { isS3: false });
    assert.equal(plan.ext, 'webp');
  });

  it('原图超过上限但压缩可过 → 自动降级为压缩', async () => {
    const size = IMAGE_ORIGINAL_MAX_BYTES + 1024;
    assert.ok(size < IMAGE_MAX_SOURCE_BYTES, '用例前提：体积落在两档之间');
    const plan = await planUpload(makeFile('big.jpg', JPEG, size), 'original', { isS3: false });
    assert.equal(plan.mode, 'compress');
    assert.equal(plan.ext, 'webp');
    assert.ok(plan.modeReason && plan.modeReason.includes('自动压缩'));
  });

  it('压缩模式超过源文件上限 → 拒绝', async () => {
    const file = makeFile('huge.jpg', JPEG, IMAGE_MAX_SOURCE_BYTES + 1);
    await assert.rejects(
      () => planUpload(file, 'compress', { isS3: false }),
      (err: unknown) => err instanceof UploadRejected && /超过上限/.test(err.message)
    );
  });
});

describe('planUpload —— 视频', () => {
  it('MP4 → video / 原样上传 / ext=mp4', async () => {
    const plan = await planUpload(makeFile('a.mp4', ftyp('isom')), 'compress', { isS3: false });
    assert.equal(plan.kind, 'video');
    assert.equal(plan.mode, 'original');
    assert.equal(plan.ext, 'mp4');
    assert.equal(shouldCompress(plan), false);
    assert.ok(plan.modeReason && plan.modeReason.includes('不压缩'));
  });

  it('mov 品牌（qt）→ ext=mov', async () => {
    const plan = await planUpload(makeFile('a.mov', ftyp('qt')), 'original', { isS3: false });
    assert.equal(plan.ext, 'mov');
  });

  it('M4V 品牌 → ext=m4v', async () => {
    const plan = await planUpload(makeFile('a.m4v', ftyp('M4V')), 'original', { isS3: false });
    assert.equal(plan.ext, 'm4v');
  });

  it('WebM（EBML + webm）识别为 webm', async () => {
    const bytes = [0x1a, 0x45, 0xdf, 0xa3, ...new TextEncoder().encode('....webm')];
    const plan = await planUpload(makeFile('a.webm', bytes), 'original', { isS3: false });
    assert.equal(plan.ext, 'webm');
  });

  it('Matroska 拒绝并提示转码', async () => {
    const bytes = [0x1a, 0x45, 0xdf, 0xa3, ...new TextEncoder().encode('..matroska')];
    await assert.rejects(
      () => planUpload(makeFile('a.mkv', bytes), 'original', { isS3: false }),
      (err: unknown) => err instanceof UploadRejected && /MKV/.test(err.message) && /MP4/.test(err.message)
    );
  });

  it('GitHub 源超 25 MB 拒绝，提示改用 S3', async () => {
    const file = makeFile('big.mp4', ftyp('isom'), VIDEO_MAX_BYTES_GITHUB + 1);
    await assert.rejects(
      () => planUpload(file, 'original', { isS3: false }),
      (err: unknown) => err instanceof UploadRejected && /S3/.test(err.message)
    );
  });

  it('S3 源同样的文件放行', async () => {
    const file = makeFile('big.mp4', ftyp('isom'), VIDEO_MAX_BYTES_GITHUB + 1);
    const plan = await planUpload(file, 'original', { isS3: true });
    assert.equal(plan.kind, 'video');
  });

  it('S3 源超过 200 MB 拒绝', async () => {
    const file = makeFile('huge.mp4', ftyp('isom'), VIDEO_MAX_BYTES_S3 + 1);
    await assert.rejects(
      () => planUpload(file, 'original', { isS3: true }),
      (err: unknown) => err instanceof UploadRejected
    );
  });
});

describe('planUpload —— 拒绝路径', () => {
  it('无法识别的格式拒绝', async () => {
    await assert.rejects(
      () => planUpload(makeFile('a.txt', [0x00, 0x01, 0x02, 0x03]), 'compress', { isS3: false }),
      (err: unknown) => err instanceof UploadRejected && /无法识别/.test(err.message)
    );
  });

  it('伪装成图片的 PE 文件拒绝', async () => {
    await assert.rejects(
      () => planUpload(makeFile('evil.png', [0x4d, 0x5a, 0x90, 0x00]), 'compress', { isS3: false }),
      (err: unknown) => err instanceof UploadRejected && /EXE/.test(err.message)
    );
  });

  it('伪装成视频的 ELF 文件拒绝', async () => {
    await assert.rejects(
      () => planUpload(makeFile('evil.mp4', [0x7f, 0x45, 0x4c, 0x46]), 'original', { isS3: false }),
      (err: unknown) => err instanceof UploadRejected && /ELF/.test(err.message)
    );
  });
});

describe('sanitizeMediaFileName', () => {
  it('空格转连字符（worker 路径白名单不允许空格）', () => {
    assert.equal(sanitizeMediaFileName('屏幕录制 2026 10 23.mp4'), '屏幕录制-2026-10-23');
  });

  it('去掉非法标点', () => {
    assert.equal(sanitizeMediaFileName('a@b#c$d.png'), 'abcd');
  });

  it('保留中文、字母、数字、点、下划线、连字符', () => {
    assert.equal(sanitizeMediaFileName('测试_01-ok.png'), '测试_01-ok');
  });

  it('全非法字符时兜底为 file', () => {
    assert.equal(sanitizeMediaFileName('@@@.png'), 'file');
  });

  it('连续连字符折叠、首尾清理', () => {
    assert.equal(sanitizeMediaFileName('--a  b--.jpg'), 'a-b');
  });
});

describe('extForFormat / videoEmbedSnippet', () => {
  it('jpeg → jpg（不是 jpeg）', () => {
    assert.equal(extForFormat('jpeg'), 'jpg');
  });

  it('未知格式 → bin', () => {
    assert.equal(extForFormat('nope'), 'bin');
  });

  it('嵌入片段含 controls 与 src', () => {
    const snippet = videoEmbedSnippet('https://x/a.mp4');
    assert.ok(snippet.includes('controls'));
    assert.ok(snippet.includes('src="https://x/a.mp4"'));
  });
});
