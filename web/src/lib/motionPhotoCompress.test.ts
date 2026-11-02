// 动态照片压缩层的纯逻辑单测（提取 / 注入 XMP APP1 段）。
//
// compressMotionStill 的 Canvas 部分依赖 DOM，不进 node --test（与
// compressImage 同约束）；这里只锁字节层的提取与注入正确性。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractXmpApp1Segment,
  injectXmpApp1Segment,
} from './motionPhotoCompress.ts';

const enc = new TextEncoder();
const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';

/** 构造一个含 XMP APP1 段的 JPEG 字节 */
function buildJpegWithXmp(xmp: string, extraApp1 = false): Uint8Array {
  const xmpBytes = enc.encode(xmp);
  const nsBytes = enc.encode(XMP_NS);
  // APP1 段：FFE1 + 长度(2B，含长度字段自身) + namespace + xmp
  const segContent = new Uint8Array(nsBytes.length + xmpBytes.length);
  segContent.set(nsBytes, 0);
  segContent.set(xmpBytes, nsBytes.length);
  const segLen = 2 + segContent.length; // 长度字段计入自身
  const app1 = new Uint8Array(2 + segLen);
  app1[0] = 0xff; app1[1] = 0xe1;
  app1[2] = (segLen >> 8) & 0xff; app1[3] = segLen & 0xff;
  app1.set(segContent, 4);

  const parts: Uint8Array[] = [[0xff, 0xd8]]; // SOI
  if (extraApp1) {
    // 前置一个 Exif APP1（非 XMP），验证不被误取
    const exifContent = enc.encode('Exif\0\0II*\0');
    const exifSeg = new Uint8Array(2 + 2 + exifContent.length);
    exifSeg[0] = 0xff; exifSeg[1] = 0xe1;
    exifSeg[2] = 0; exifSeg[3] = 2 + exifContent.length;
    exifSeg.set(exifContent, 4);
    parts.push(exifSeg);
  }
  parts.push(app1);
  parts.push([0xff, 0xd9]); // EOI

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

describe('extractXmpApp1Segment', () => {
  it('提取 XMP APP1 段完整字节', () => {
    const jpeg = buildJpegWithXmp('<x:xmpmeta>x</x:xmpmeta>');
    const seg = extractXmpApp1Segment(jpeg);
    assert.ok(seg);
    assert.equal(seg[0], 0xff);
    assert.equal(seg[1], 0xe1);
    // 段内容含 namespace + xmp
    const content = new TextDecoder().decode(seg.subarray(4));
    assert.ok(content.startsWith(XMP_NS));
    assert.ok(content.includes('<x:xmpmeta>'));
  });

  it('跳过非 XMP 的 APP1（Exif），仍命中 XMP', () => {
    const jpeg = buildJpegWithXmp('xmp', true);
    const seg = extractXmpApp1Segment(jpeg);
    assert.ok(seg, '应跳过 Exif APP1 找到 XMP APP1');
  });

  it('非 JPEG（无 SOI）返回 null', () => {
    assert.equal(extractXmpApp1Segment(new Uint8Array([1, 2, 3, 4])), null);
  });

  it('无 XMP APP1 返回 null', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    assert.equal(extractXmpApp1Segment(jpeg), null);
  });
});

describe('injectXmpApp1Segment', () => {
  it('XMP 段紧随 SOI 注入，其余字节保持', () => {
    const src = buildJpegWithXmp('<x:xmpmeta>x</x:xmpmeta>');
    const seg = extractXmpApp1Segment(src)!;
    // 目标：一个「已压缩」的纯 JPEG（SOI + EOI，无 XMP）
    const target = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const out = injectXmpApp1Segment(target, seg);

    assert.equal(out[0], 0xff);
    assert.equal(out[1], 0xd8);
    // 紧随 SOI 的是 XMP 段
    assert.equal(out[2], 0xff);
    assert.equal(out[3], 0xe1);
    // 总长 = 原 + 段长
    assert.equal(out.length, target.length + seg.length);
    // 尾部 EOI 仍在
    assert.equal(out[out.length - 2], 0xff);
    assert.equal(out[out.length - 1], 0xd9);
  });

  it('注入后可再次提取出同一段（往返一致）', () => {
    const src = buildJpegWithXmp('<x:xmpmeta>y</x:xmpmeta>');
    const seg = extractXmpApp1Segment(src)!;
    const target = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const out = injectXmpApp1Segment(target, seg);
    const re = extractXmpApp1Segment(out);
    assert.ok(re);
    assert.deepEqual(Array.from(re), Array.from(seg));
  });

  it('非 JPEG 目标抛错', () => {
    const seg = new Uint8Array([0xff, 0xe1, 0, 2]);
    assert.throws(() => injectXmpApp1Segment(new Uint8Array([1, 2]), seg));
  });
});
