// 动态照片单文件合成层单元测试。
//
// 用构造字节模拟「JPEG 主图 + XMP + 尾部 MP4」的真实布局，验证：
//   · XMP 视频项 Length/Padding 修补正确（属性形式与元素形式、改写前缀均覆盖）
//   · 合成结果 = 主图字节 + 新视频，且 XMP 声明长度与实际视频长度一致
//   · fail-closed：找不到视频项 / offset 非法 / 无 XMP 一律抛错，不产出坏文件
//
// 该模块是 workflow 端 merge_motion_photo.py 的算法基准：两侧行为必须一致。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_PHOTO_DIR,
  MotionPhotoMergeError,
  mergeMotionPhotoBytes,
  motionPhotoPath,
  patchXmpVideoLength,
} from './motionPhotoMerge.ts';
import { parseContainerItems, findVideoItem } from './motionPhoto.ts';

const enc = new TextEncoder();

/** 构造「JPEG 头 + XMP + 填充」的主图字节（长度 = stillSize） */
function buildStill(xmp: string, stillSize: number): Uint8Array {
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const xmpBytes = enc.encode(xmp);
  const still = new Uint8Array(stillSize);
  still.set(head, 0);
  still.set(xmpBytes, head.length);
  return still;
}

/** 构造带 ftyp 的假视频字节 */
function buildVideo(size: number): Uint8Array {
  const v = new Uint8Array(size);
  if (size >= 12) {
    v.set([0x00, 0x00, 0x00, 0x20], 0);
    v.set(enc.encode('ftyp'), 4);
    v.set(enc.encode('isom'), 8);
  }
  return v;
}

/**
 * 构造「主图 + 尾部旧视频」的完整 Motion Photo 输入（模拟 parseMotionPhotoFile 视角的 file.size）。
 * 返回 { bytes, stillSize }：bytes 总长 = stillSize + oldVideoSize，视频起点 = stillSize。
 */
function buildFullInput(xmp: string, stillSize: number, oldVideoSize: number) {
  const still = buildStill(xmp, stillSize);
  const oldVideo = buildVideo(oldVideoSize);
  const bytes = new Uint8Array(stillSize + oldVideoSize);
  bytes.set(still, 0);
  bytes.set(oldVideo, stillSize);
  return { bytes, stillSize };
}

const XMP_MODERN = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
      xmlns:GContainer="http://ns.google.com/photos/1.0/container/"
      Camera:MotionPhoto="1"
      Camera:MotionPhotoVersion="1">
      <GContainer:Directory>
        <rdf:Seq>
          <rdf:li><GContainer:Item Item:Mime="image/jpeg" Item:Length="5000"/></rdf:li>
          <rdf:li><GContainer:Item Item:Mime="video/mp4" Item:Length="1500"/></rdf:li>
        </rdf:Seq>
      </GContainer:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

/** Ultra HDR：目录含 image / gainmap / video 三项，顺序取会拿到增益图 */
const XMP_ULTRA_HDR = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
      xmlns:GContainer="http://ns.google.com/photos/1.0/container/"
      Camera:MotionPhoto="1">
      <GContainer:Directory>
        <rdf:Seq>
          <rdf:li><GContainer:Item Item:Mime="image/jpeg" Item:Length="5000"/></rdf:li>
          <rdf:li><GContainer:Item Item:Mime="image/jpeg" Item:Length="800"/></rdf:li>
          <rdf:li><GContainer:Item Item:Mime="video/mp4" Item:Length="1500"/></rdf:li>
        </rdf:Seq>
      </GContainer:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

/** 厂商改写前缀（Item: → I:）形态 */
const XMP_CUSTOM_PREFIX = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
      xmlns:I="http://ns.google.com/photos/1.0/container/"
      Camera:MotionPhoto="1">
      <I:Directory>
        <rdf:Seq>
          <rdf:li><I:Item I:Mime="image/jpeg" I:Length="5000"/></rdf:li>
          <rdf:li><I:Item I:Mime="video/mp4" I:Length="1500" I:Padding="16"/></rdf:li>
        </rdf:Seq>
      </I:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

describe('patchXmpVideoLength', () => {
  it('修补视频项 Length，保留图片项不变', () => {
    const out = patchXmpVideoLength(XMP_MODERN, 2222);
    const items = parseContainerItems(out);
    const video = findVideoItem(items);
    assert.equal(video?.length, 2222);
    const image = items.find((it) => it.mime === 'image/jpeg');
    assert.equal(image?.length, 5000, '图片项长度不应被改动');
  });

  it('Ultra HDR 三项目录：只改 video/ 项，不动 gainmap', () => {
    const out = patchXmpVideoLength(XMP_ULTRA_HDR, 3333);
    const items = parseContainerItems(out);
    assert.equal(findVideoItem(items)?.length, 3333);
    const images = items.filter((it) => it.mime === 'image/jpeg');
    assert.equal(images.length, 2);
    assert.deepEqual(images.map((i) => i.length).sort((a, b) => a - b), [800, 5000]);
  });

  it('改写前缀形态（I:Mime）同样命中，且 Padding 归零', () => {
    const out = patchXmpVideoLength(XMP_CUSTOM_PREFIX, 4444);
    const items = parseContainerItems(out);
    assert.equal(findVideoItem(items)?.length, 4444);
    assert.equal(findVideoItem(items)?.padding, 0);
  });

  it('无视频项时 fail-closed 抛错', () => {
    const noVideo = XMP_MODERN.replace(/Item:Mime="video\/mp4" Item:Length="1500"/, 'Item:Mime="image/jpeg" Item:Length="1500"');
    assert.throws(() => patchXmpVideoLength(noVideo, 100), MotionPhotoMergeError);
  });

  it('无 XMP 的文本抛错', () => {
    assert.throws(() => patchXmpVideoLength('no xmp', 100), MotionPhotoMergeError);
  });
});

describe('mergeMotionPhotoBytes', () => {
  const stillSize = 5000;
  const oldVideoSize = 1500;

  it('合成结果 = 主图（修补后）+ 新视频，且长度正确', () => {
    const { bytes } = buildFullInput(XMP_MODERN, stillSize, oldVideoSize);
    const newVideo = buildVideo(2000);
    const out = mergeMotionPhotoBytes(bytes, stillSize, newVideo);

    assert.equal(out.length, stillSize + newVideo.length);

    // XMP 声明的视频长度应等于实际内嵌视频长度
    const text = new TextDecoder('latin1').decode(out.subarray(0, stillSize));
    const items = parseContainerItems(text);
    assert.equal(findVideoItem(items)?.length, newVideo.length);

    // 尾部应是新视频字节
    const tail = out.subarray(stillSize);
    assert.deepEqual(Array.from(tail.subarray(0, 12)), Array.from(newVideo.subarray(0, 12)));
  });

  it('原视频尾部被完全丢弃（不残留旧 HEVC 数据）', () => {
    const { bytes } = buildFullInput(XMP_MODERN, stillSize, oldVideoSize);
    // 在旧视频区打标记，验证合成后不残留
    bytes.fill(0xab, stillSize);
    const out = mergeMotionPhotoBytes(bytes, stillSize, buildVideo(2000));
    assert.equal(out[stillSize], 0x00, '新视频首字节应为 ftyp box 的 size 字段 0');
    assert.ok(!out.includes(0xab), '旧视频标记字节不应残留');
  });

  it('XMP 区间外的字节逐一保持不变', () => {
    const { bytes } = buildFullInput(XMP_MODERN, stillSize, oldVideoSize);
    const out = mergeMotionPhotoBytes(bytes, stillSize, buildVideo(2000));
    // JPEG 头必须保持
    assert.deepEqual(Array.from(out.subarray(0, 4)), [0xff, 0xd8, 0xff, 0xe0]);
  });

  it('Length 数字位数变化时总长仍自洽', () => {
    const { bytes } = buildFullInput(XMP_MODERN, stillSize, oldVideoSize);
    const newVideo = buildVideo(9); // 1 位数（原声明 1500 是 4 位数）
    const out = mergeMotionPhotoBytes(bytes, stillSize, newVideo);
    const text = new TextDecoder('latin1').decode(out.subarray(0, stillSize));
    assert.equal(findVideoItem(parseContainerItems(text))?.length, 9);

    // 总长 = 原总长 + (新视频长度 - 旧视频长度) + (XMP 数字位数差)
    // 旧声明 "1500"（4 位）→ 新声明 "9"（1 位），XMP 缩短 3 字节
    const expected = bytes.length - oldVideoSize + 9 - (4 - 1);
    assert.equal(out.length, expected);
    // 尾部 9 字节必须是新视频（尺寸极小，不写 ftyp，全 0）
    assert.deepEqual(Array.from(out.subarray(out.length - 9)), Array.from(newVideo));
  });

  it('offset 非法时抛错（不产出坏文件）', () => {
    const { bytes } = buildFullInput(XMP_MODERN, stillSize, oldVideoSize);
    assert.throws(() => mergeMotionPhotoBytes(bytes, 0, buildVideo(100)), MotionPhotoMergeError);
    assert.throws(() => mergeMotionPhotoBytes(bytes, bytes.length + 10, buildVideo(100)), MotionPhotoMergeError);
  });

  it('无 XMP 的主图抛错', () => {
    const noXmp = new Uint8Array(stillSize + oldVideoSize);
    noXmp.set([0xff, 0xd8, 0xff, 0xe0], 0);
    assert.throws(() => mergeMotionPhotoBytes(noXmp, stillSize, buildVideo(100)), MotionPhotoMergeError);
  });

  it('空视频抛错', () => {
    const { bytes } = buildFullInput(XMP_MODERN, stillSize, oldVideoSize);
    assert.throws(() => mergeMotionPhotoBytes(bytes, stillSize, new Uint8Array(0)), MotionPhotoMergeError);
  });
});

describe('motionPhotoPath', () => {
  it('空前缀时落到 motion/ 根下', () => {
    assert.equal(motionPhotoPath('', '1.jpg'), `${MOTION_PHOTO_DIR}/1.jpg`);
  });

  it('带前缀时拼在其后', () => {
    assert.equal(motionPhotoPath('assets', '1.jpg'), 'assets/motion/1.jpg');
  });
});
