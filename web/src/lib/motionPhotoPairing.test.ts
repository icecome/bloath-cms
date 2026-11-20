// 动态照片列表聚合层单元测试。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STALE_TRANSCODE_MS,
  filterMotionIntermediates,
  buildTranscodingEntries,
  motionFileRole,
  splitDirAndStem,
  type MotionPairFile,
} from './motionPhotoPairing.ts';

/** 便捷构造一个文件条目 */
function f(path: string, size = 100): MotionPairFile {
  const name = path.split('/').pop() || path;
  return { name, path, sha: '', size, url: `https://cdn/${path}`, lastModified: 0 };
}

const isDerived = (name: string) => name.startsWith('thumb-');
const toDisplay = <T extends MotionPairFile>(x: T): T => x;
const urlFor = (path: string) => `https://cdn/${path}`;

describe('motionFileRole', () => {
  it('区分四类文件', () => {
    assert.equal(motionFileRole('1.motion.json'), 'manifest');
    assert.equal(motionFileRole('1.src.jpg'), 'still-source');
    assert.equal(motionFileRole('1.src.mp4'), 'video-source');
    assert.equal(motionFileRole('1.jpg'), 'plain');
    assert.equal(motionFileRole('1.mp4'), 'plain');
  });
});

describe('splitDirAndStem', () => {
  it('拆目录与基础名', () => {
    assert.deepEqual(splitDirAndStem('motion/1.jpg'), { dir: 'motion', stem: '1' });
    assert.deepEqual(splitDirAndStem('1.jpg'), { dir: '', stem: '1' });
    assert.deepEqual(splitDirAndStem('motion/a.b.c.jpg'), { dir: 'motion', stem: 'a.b.c' });
  });
});

describe('filterMotionIntermediates', () => {
  it('剔除 thumb-*、*.src.*、*.motion.json，保留普通文件', () => {
    const files = [
      f('motion/1.jpg'),
      f('motion/1.src.jpg'),
      f('motion/1.src.mp4'),
      f('motion/1.motion.json'),
      f('thumb-1.webp'),
      f('assets/plain.jpg'),
    ];
    const out = filterMotionIntermediates(files, isDerived, toDisplay);
    assert.deepEqual(out.map((x) => x.path), ['motion/1.jpg', 'assets/plain.jpg']);
  });
});

describe('buildTranscodingEntries', () => {
  it('无 src.jpg 时返回空', () => {
    const files = [f('motion/1.jpg'), f('motion/1.src.mp4'), f('motion/1.motion.json')];
    assert.deepEqual(buildTranscodingEntries(files, isDerived, urlFor), []);
  });

  it('src.jpg 存在且无成品 → 合成转码中条目', () => {
    const files = [f('motion/1.src.jpg'), f('motion/1.src.mp4'), f('motion/1.motion.json')];
    const out = buildTranscodingEntries(files, isDerived, urlFor);
    assert.equal(out.length, 1);
    assert.equal(out[0].transcoding, true);
    assert.equal(out[0].path, 'motion/1.src.jpg', '预览指向真实源图');
    assert.equal(out[0].outputPath, 'motion/1.jpg', '成品路径已预告');
    assert.equal(out[0].url, 'https://cdn/motion/1.src.jpg');
  });

  it('成品已就绪时不再为 src.jpg 建转码条目（残留场景）', () => {
    const files = [f('motion/1.jpg'), f('motion/1.src.jpg')];
    assert.deepEqual(buildTranscodingEntries(files, isDerived, urlFor), []);
  });

  it('多张动态照片各自成条目、去重', () => {
    const files = [
      f('motion/1.src.jpg'), f('motion/1.src.mp4'),
      f('motion/2.src.jpg'), f('motion/2.src.mp4'),
    ];
    const out = buildTranscodingEntries(files, isDerived, urlFor);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((x) => x.outputPath).sort(), ['motion/1.jpg', 'motion/2.jpg']);
  });

  it('跳过缩略图派生产物', () => {
    const files = [f('motion/1.src.jpg'), f('thumb-1.webp')];
    const out = buildTranscodingEntries(files, isDerived, urlFor);
    assert.equal(out.length, 1);
  });

  it('stale 判定：lastModified 超过阈值 → stale=true（m-04）', () => {
    const now = 1_700_000_000_000;
    const fresh = { ...f('motion/1.src.jpg'), lastModified: now - 60_000 }; // 1 分钟前
    const stale = { ...f('motion/2.src.jpg'), lastModified: now - STALE_TRANSCODE_MS - 60_000 }; // 超 2h
    const out = buildTranscodingEntries([fresh, stale], isDerived, urlFor, now);
    assert.equal(out.length, 2);
    assert.equal(out.find((x) => x.path === 'motion/1.src.jpg')?.stale, false);
    assert.equal(out.find((x) => x.path === 'motion/2.src.jpg')?.stale, true);
  });

  it('stale 判定：恰在阈值边界（now - lastModified == 阈值）不算 stale', () => {
    const now = 1_700_000_000_000;
    const edge = { ...f('motion/1.src.jpg'), lastModified: now - STALE_TRANSCODE_MS };
    const out = buildTranscodingEntries([edge], isDerived, urlFor, now);
    assert.equal(out[0].stale, false, '条件是严格大于（>），等于阈值不触发');
  });
});
