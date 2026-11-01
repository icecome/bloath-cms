// 服务端转码决策层单元测试（命名契约 + 策略矩阵）。
// 与图床仓库 workflow 的匹配模式互为契约：改这里必须同步 workflow。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVER_TRANSCODE_SRC_SUFFIX,
  isServerTranscodeSource,
  serverTranscodeOutputName,
  embeddedVideoStrategy,
} from './motionPhotoServerTranscode.ts';

describe('isServerTranscodeSource', () => {
  it('匹配 .src.mp4（大小写不敏感）', () => {
    assert.equal(isServerTranscodeSource('a.src.mp4'), true);
    assert.equal(isServerTranscodeSource('a.SRC.MP4'), true);
    assert.equal(isServerTranscodeSource('2026/10/a.src.mp4'), true);
  });

  it('不匹配普通视频与产物文件', () => {
    assert.equal(isServerTranscodeSource('a.mp4'), false);
    assert.equal(isServerTranscodeSource('a.src.mp'), false);
    assert.equal(isServerTranscodeSource('a.mp4.src'), false);
    assert.equal(isServerTranscodeSource('src.mp4'), false, '无后缀段不算源文件');
  });
});

describe('serverTranscodeOutputName', () => {
  it('源文件名 → 产物文件名', () => {
    assert.equal(serverTranscodeOutputName('a.src.mp4'), 'a.mp4');
    assert.equal(serverTranscodeOutputName('IMG_0001.src.mp4'), 'IMG_0001.mp4');
  });

  it('非源文件名原样返回（幂等防御）', () => {
    assert.equal(serverTranscodeOutputName('a.mp4'), 'a.mp4');
    assert.equal(serverTranscodeOutputName('a.jpg'), 'a.jpg');
  });
});

describe('embeddedVideoStrategy', () => {
  it('H.264（avc1/avc3）→ native，与通道无关', () => {
    assert.equal(embeddedVideoStrategy('avc1', { isS3: false }), 'native');
    assert.equal(embeddedVideoStrategy('avc3', { isS3: false }), 'native');
    assert.equal(embeddedVideoStrategy('avc1', { isS3: true }), 'native');
  });

  it('HEVC/AV1 + GitHub 通道 → server', () => {
    assert.equal(embeddedVideoStrategy('hvc1', { isS3: false }), 'server');
    assert.equal(embeddedVideoStrategy('hev1', { isS3: false }), 'server');
    assert.equal(embeddedVideoStrategy('av01', { isS3: false }), 'server');
  });

  it('HEVC/AV1 + S3 通道 → browser（无 Actions 可借）', () => {
    assert.equal(embeddedVideoStrategy('hvc1', { isS3: true }), 'browser');
    assert.equal(embeddedVideoStrategy('av01', { isS3: true }), 'browser');
  });

  it('未识别编码按不可播处理，同 HEVC 分流', () => {
    assert.equal(embeddedVideoStrategy(null, { isS3: false }), 'server');
    assert.equal(embeddedVideoStrategy(null, { isS3: true }), 'browser');
  });
});

describe('命名契约自检', () => {
  it('后缀常量本身不被识别为源文件（防 workflow 死循环的锚点）', () => {
    assert.equal(SERVER_TRANSCODE_SRC_SUFFIX, '.src.mp4');
    assert.equal(isServerTranscodeSource('a' + SERVER_TRANSCODE_SRC_SUFFIX), true);
    assert.equal(
      isServerTranscodeSource(serverTranscodeOutputName('a' + SERVER_TRANSCODE_SRC_SUFFIX)),
      false,
      '产物名不得再匹配源模式'
    );
  });
});
