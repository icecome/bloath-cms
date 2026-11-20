// 动态照片合成清单（motion.json）单元测试。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_MANIFEST_SUFFIX,
  MOTION_MANIFEST_VERSION,
  buildMotionManifest,
  isMotionManifestName,
  isMotionStillSourceName,
  motionBaseNameOf,
  motionManifestName,
  parseMotionManifest,
} from './motionPhotoManifest.ts';

describe('文件名判定', () => {
  it('识别清单文件（大小写不敏感）', () => {
    assert.equal(isMotionManifestName('1.motion.json'), true);
    assert.equal(isMotionManifestName('2026/11/a.MOTION.JSON'), true);
    assert.equal(isMotionManifestName('1.json'), false);
    assert.equal(isMotionManifestName('motion.json'), false);
  });

  it('识别主图源文件（.src.jpg / .src.jpeg）', () => {
    assert.equal(isMotionStillSourceName('1.src.jpg'), true);
    assert.equal(isMotionStillSourceName('1.src.jpeg'), true);
    assert.equal(isMotionStillSourceName('1.src.JPG'), true);
    assert.equal(isMotionStillSourceName('1.jpg'), false);
    assert.equal(isMotionStillSourceName('1.src.mp4'), false);
  });

  it('反推 baseName：三类文件指向同一 baseName', () => {
    assert.equal(motionBaseNameOf('1.src.jpg'), '1');
    assert.equal(motionBaseNameOf('1.src.mp4'), '1');
    assert.equal(motionBaseNameOf('1.motion.json'), '1');
    assert.equal(motionBaseNameOf('plain.jpg'), null);
  });

  it('清单文件名由 baseName 生成', () => {
    assert.equal(motionManifestName('1'), '1.motion.json');
  });
});

describe('buildMotionManifest', () => {
  it('构造合法清单', () => {
    const m = buildMotionManifest('1', { videoOffset: 2845213, videoLength: 2387412 });
    assert.equal(m.v, MOTION_MANIFEST_VERSION);
    assert.equal(m.type, 'motion-photo-merge');
    assert.equal(m.stillSource, '1.src.jpg');
    assert.equal(m.videoSource, '1.src.mp4');
    assert.equal(m.output, '1.jpg');
    assert.equal(m.videoOffset, 2845213);
    assert.equal(m.videoLength, 2387412);
    assert.equal(m.presentationTimestampUs, null);
  });

  it('携带呈现时间戳', () => {
    const m = buildMotionManifest('1', { videoOffset: 100, videoLength: 100, presentationTimestampUs: 1500000 });
    assert.equal(m.presentationTimestampUs, 1500000);
  });
});

describe('parseMotionManifest', () => {
  const valid = buildMotionManifest('1', { videoOffset: 2845213, videoLength: 2387412 });

  it('解析合法清单', () => {
    const m = parseMotionManifest(JSON.stringify(valid));
    assert.ok(m);
    assert.equal(m.output, '1.jpg');
    assert.equal(m.videoOffset, 2845213);
  });

  it('JSON 非法返回 null', () => {
    assert.equal(parseMotionManifest('not json'), null);
  });

  it('版本不符返回 null', () => {
    const bad = { ...valid, v: 999 };
    assert.equal(parseMotionManifest(JSON.stringify(bad)), null);
  });

  it('type 不符返回 null', () => {
    const bad = { ...valid, type: 'other' };
    assert.equal(parseMotionManifest(JSON.stringify(bad)), null);
  });

  it('offset 非法（<=1024）返回 null', () => {
    const bad = { ...valid, videoOffset: 100 };
    assert.equal(parseMotionManifest(JSON.stringify(bad)), null);
  });

  it('length 非法（<=0）返回 null', () => {
    const bad = { ...valid, videoLength: 0 };
    assert.equal(parseMotionManifest(JSON.stringify(bad)), null);
  });

  it('缺必填字段返回 null', () => {
    const bad = { ...valid };
    delete (bad as Record<string, unknown>).videoSource;
    assert.equal(parseMotionManifest(JSON.stringify(bad)), null);
  });

  it('presentationTimestampUs 类型不符返回 null', () => {
    const bad = { ...valid, presentationTimestampUs: 'abc' };
    assert.equal(parseMotionManifest(JSON.stringify(bad)), null);
  });

  it('后缀常量自检', () => {
    assert.equal(MOTION_MANIFEST_SUFFIX, '.motion.json');
  });
});
