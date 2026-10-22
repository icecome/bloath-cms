// 格式嗅探单元测试（P3-3）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImageFormat, validateImageUpload } from './formatSniff.ts';

/** 用字节序列构造 File（浏览器 File 在 happy-dom/node 18+ 可用；此处用 Blob + name 模拟） */
function makeFile(bytes: number[], name: string): File {
  const arr = new Uint8Array(bytes);
  return new File([arr], name, { type: 'application/octet-stream' });
}

// 各格式魔数样本
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const BMP = [0x42, 0x4d, 0x36, 0x00];
const AVIF = [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66];
const EXE = [0x4d, 0x5a, 0x90, 0x00];
const ELF = [0x7f, 0x45, 0x4c, 0x46];
const SHELL = Array.from(new TextEncoder().encode('#!/bin/sh\n'));
const PDF = Array.from(new TextEncoder().encode('%PDF-1.4'));
const UNKNOWN = [0x01, 0x02, 0x03, 0x04];

describe('sniffImageFormat', () => {
  it('识别 jpeg / png / gif / webp / bmp / avif', async () => {
    assert.equal(await sniffImageFormat(makeFile(JPEG, 'a.jpg')), 'jpeg');
    assert.equal(await sniffImageFormat(makeFile(PNG, 'a.png')), 'png');
    assert.equal(await sniffImageFormat(makeFile(GIF, 'a.gif')), 'gif');
    assert.equal(await sniffImageFormat(makeFile(WEBP, 'a.webp')), 'webp');
    assert.equal(await sniffImageFormat(makeFile(BMP, 'a.bmp')), 'bmp');
    assert.equal(await sniffImageFormat(makeFile(AVIF, 'a.avif')), 'avif');
  });

  it('识别伪装的可执行内容', async () => {
    assert.equal(await sniffImageFormat(makeFile(EXE, 'a.png')), 'dangerous:EXE');
    assert.equal(await sniffImageFormat(makeFile(ELF, 'a.png')), 'dangerous:ELF');
    assert.equal(await sniffImageFormat(makeFile(SHELL, 'a.png')), 'dangerous:shell');
    assert.equal(await sniffImageFormat(makeFile(PDF, 'a.png')), 'dangerous:PDF');
  });

  it('无法识别返回 unknown', async () => {
    assert.equal(await sniffImageFormat(makeFile(UNKNOWN, 'a.png')), 'unknown');
  });
});

describe('validateImageUpload', () => {
  it('扩展名与魔数一致 → 通过（null）', async () => {
    assert.equal(await validateImageUpload(makeFile(PNG, 'photo.png')), null);
    assert.equal(await validateImageUpload(makeFile(JPEG, 'photo.jpg')), null);
  });

  it('扩展名改名（png 内容存成 jpg）→ 拒绝', async () => {
    const msg = await validateImageUpload(makeFile(PNG, 'photo.jpg'));
    assert.ok(msg?.includes('实际格式是 png'));
  });

  it('可执行内容伪装图片 → 拒绝并说明', async () => {
    const msg = await validateImageUpload(makeFile(EXE, 'mal.png'));
    assert.ok(msg?.includes('EXE'));
  });

  it('PDF 伪装 → 拒绝', async () => {
    const msg = await validateImageUpload(makeFile(PDF, 'doc.png'));
    assert.ok(msg?.includes('PDF'));
  });

  it('无法识别 → 拒绝', async () => {
    const msg = await validateImageUpload(makeFile(UNKNOWN, 'x.png'));
    assert.ok(msg?.includes('无法识别'));
  });

  it('SVG 文本校验：含 <svg 通过', async () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="..."></svg>');
    assert.equal(await validateImageUpload(makeFile(Array.from(svg), 'icon.svg')), null);
  });

  it('SVG 文本校验：二进制伪装 → 拒绝', async () => {
    const msg = await validateImageUpload(makeFile(UNKNOWN, 'icon.svg'));
    assert.ok(msg?.includes('SVG'));
  });
});
