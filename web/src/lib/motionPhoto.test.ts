// Motion Photo（安卓动态照片）解析层单元测试。
//
// 不依赖真实媒体文件：用构造的字节数组模拟 JPEG 头 + XMP + 尾部 MP4 的真实布局，
// 覆盖小米/努比亚等机型的两种 XMP 标准（新 GContainer:Item:Length + 旧 MicroVideoOffset）、
// Ultra HDR 三项目录、前缀改写、以及 XMP 被剥离的兜底场景。
//
// 【重点】parseMotionPhotoFile(Blob) 是**生产调用路径**，必须测——
// 此前的缺陷正是「parseMotionPhoto(完整字节) 测过了，但真实调用只喂文件头」。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractXmpPacket,
  parseNamespacePrefixes,
  prefixesForNamespace,
  parseMotionPhotoFlag,
  parseMotionPhotoVersion,
  parseContainerVideoLength,
  parseMicroVideoOffset,
  parseContainerItems,
  findVideoItem,
  parseMotionPhotoHeader,
  parseMotionPhoto,
  parseMotionPhotoFile,
  extractMotionPhotoVideo,
  needsMotionPhotoTranscode,
  detectEmbeddedVideoCodec,
  isBrowserNativeCodec,
  locateVideoInFullBytes,
} from './motionPhoto.ts';

const enc = new TextEncoder();

/** 构造一个「JPEG 主图 + XMP + 内嵌 MP4」的完整 Motion Photo 文件 */
function buildMotionPhoto(opts: {
  xmp: string;
  stillBytes?: number;
  videoBytes?: number;
  includeMfTyp?: boolean;
  /** 内嵌视频的 stsd fourcc（默认不写 stsd） */
  videoCodec?: string;
}): Uint8Array {
  const stillSize = opts.stillBytes ?? 5000;
  const videoSize = opts.videoBytes ?? 1500;

  // JPEG 头（保证 sniffMedia 认得出是 jpeg）
  const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  // XMP 作为 APP1 段嵌入 JPEG（位置：JPEG 头 + XMP 文本）
  const xmpBytes = enc.encode(opts.xmp);
  // 填充到 stillSize：用 0 填充（不会被误认为 ftyp）
  const fill = new Uint8Array(Math.max(0, stillSize - jpegHead.length - xmpBytes.length));
  const still = new Uint8Array(jpegHead.length + xmpBytes.length + fill.length);
  still.set(jpegHead, 0);
  still.set(xmpBytes, jpegHead.length);
  still.set(fill, jpegHead.length + xmpBytes.length);

  // 尾部 MP4（ftyp box 头，供兜底扫描）
  let video: Uint8Array;
  if (opts.includeMfTyp === false || videoSize < 12) {
    video = new Uint8Array(videoSize);
  } else {
    video = new Uint8Array(videoSize);
    // size(4) + 'ftyp'(4) + major brand(4)
    video.set([0x00, 0x00, 0x00, 0x20], 0);
    video.set(enc.encode('ftyp'), 4);
    video.set(enc.encode('isom'), 8);

    if (opts.videoCodec) {
      // 追加一个 stsd box：size(4)+'stsd'(4)+ver/flags(4)+entry_count(4)
      //                  + entry_size(4) + fourcc(4)
      const stsd = new Uint8Array(24);
      stsd.set([0x00, 0x00, 0x00, 0x18], 0);
      stsd.set(enc.encode('stsd'), 4);
      stsd.set([0x00, 0x00, 0x00, 0x01], 12); // entry_count = 1
      stsd.set([0x00, 0x00, 0x00, 0x10], 16); // entry size
      stsd.set(enc.encode(opts.videoCodec), 20);
      video.set(stsd, 12);
    }
  }

  const out = new Uint8Array(still.length + video.length);
  out.set(still, 0);
  out.set(video, still.length);
  return out;
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

const XMP_LEGACY = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
      Camera:MotionPhoto="1"
      Camera:MicroVideoOffset="1500"/>
  </rdf:RDF>
</x:xmpmeta>`;

describe('extractXmpPacket', () => {
  it('从字节流提取完整 XMP 包', () => {
    const bytes = enc.encode(`PREFIX<x:xmpmeta>content</x:xmpmeta>SUFFIX`);
    const xmp = extractXmpPacket(bytes);
    assert.ok(xmp?.startsWith('<x:xmpmeta>'));
    assert.ok(xmp?.endsWith('</x:xmpmeta>'));
  });

  it('无 XMP 返回 null', () => {
    assert.equal(extractXmpPacket(enc.encode('no xmp here')), null);
  });

  it('XMP 未闭合返回 null', () => {
    assert.equal(extractXmpPacket(enc.encode('<x:xmpmeta>unclosed')), null);
  });
});

describe('namespace 前缀解析', () => {
  it('收集 xmlns:PREFIX="URI"', () => {
    const map = parseNamespacePrefixes('<a xmlns:Camera="http://ns.google.com/photos/1.0/camera/"/>');
    assert.equal(map.get('Camera'), 'http://ns.google.com/photos/1.0/camera/');
  });

  it('单引号也支持', () => {
    const map = parseNamespacePrefixes("<a xmlns:I='http://ns.google.com/photos/1.0/container/'/>");
    assert.equal(map.get('I'), 'http://ns.google.com/photos/1.0/container/');
  });

  it('按 URI 反查前缀', () => {
    const xmp = '<a xmlns:Camera="http://ns.google.com/photos/1.0/camera/"/>';
    assert.deepEqual(prefixesForNamespace(xmp, 'http://ns.google.com/photos/1.0/camera/'), ['Camera']);
    assert.deepEqual(prefixesForNamespace(xmp, 'http://nope'), []);
  });
});

describe('parseMotionPhotoFlag / Version', () => {
  it('解析元素形式 MotionPhoto=1', () => {
    const xmp = '<Camera:MotionPhoto>1</Camera:MotionPhoto>';
    assert.equal(parseMotionPhotoFlag(xmp), 1);
  });

  it('解析属性形式 MotionPhoto="1"', () => {
    const xmp = '<x Camera:MotionPhoto="1"/>';
    assert.equal(parseMotionPhotoFlag(xmp), 1);
  });

  it('MotionPhoto=0 返回 0（非动态照片）', () => {
    assert.equal(parseMotionPhotoFlag('<Camera:MotionPhoto>0</Camera:MotionPhoto>'), 0);
  });

  it('缺失返回 null', () => {
    assert.equal(parseMotionPhotoFlag('<x></x>'), null);
  });

  it('解析 MotionPhotoVersion', () => {
    assert.equal(parseMotionPhotoVersion('<Camera:MotionPhotoVersion>1</Camera:MotionPhotoVersion>'), 1);
    assert.equal(parseMotionPhotoVersion('<x Camera:MotionPhotoVersion="2"/>'), 2);
    assert.equal(parseMotionPhotoVersion('<x></x>'), null);
  });
});

describe('parseContainerItems / findVideoItem', () => {
  it('标准双 Item 结构取到视频项', () => {
    const items = parseContainerItems(XMP_MODERN);
    assert.equal(items.length, 2);
    const video = findVideoItem(items);
    assert.ok(video);
    assert.equal(video.mime, 'video/mp4');
    assert.equal(video.length, 1500);
  });

  it('Ultra HDR 三项（image/gainmap/video）按 Mime 定位视频，不按序号', () => {
    const xmp = `<GContainer:Directory><rdf:Seq>
      <rdf:li><GContainer:Item Item:Mime="image/jpeg" Item:Length="3000000"/></rdf:li>
      <rdf:li><GContainer:Item Item:Mime="image/jpeg" Item:Length="200000"/></rdf:li>
      <rdf:li><GContainer:Item Item:Mime="video/mp4" Item:Length="4000000"/></rdf:li>
    </rdf:Seq></GContainer:Directory>`;
    const video = findVideoItem(parseContainerItems(xmp));
    assert.equal(video?.length, 4000000);
    // 旧实现取 lengths[1] 会拿到增益图长度
    assert.notEqual(parseContainerVideoLength(xmp), 200000);
  });

  it('前缀改写为 I: 仍能解析', () => {
    const xmp = `<I:Directory xmlns:I="http://ns.google.com/photos/1.0/container/">
      <I:Item I:Mime="image/jpeg" I:Length="100"/>
      <I:Item I:Mime="video/mp4" I:Length="2000"/>
    </I:Directory>`;
    assert.equal(findVideoItem(parseContainerItems(xmp))?.length, 2000);
  });

  it('无 Mime 时退回最后带长度的项', () => {
    const xmp = '<GContainer:Item Item:Length="100"/><GContainer:Item Item:Length="2000"/>';
    assert.equal(findVideoItem(parseContainerItems(xmp))?.length, 2000);
  });

  it('读取 Item:Padding', () => {
    const xmp = '<GContainer:Item Item:Mime="video/mp4" Item:Length="1500" Item:Padding="64"/>';
    assert.equal(findVideoItem(parseContainerItems(xmp))?.padding, 64);
  });

  it('无 Item 返回 null', () => {
    assert.deepEqual(parseContainerItems('<x></x>'), []);
    assert.equal(findVideoItem(parseContainerItems('<x></x>')), null);
  });
});

describe('parseMicroVideoOffset', () => {
  it('元素形式', () => {
    assert.equal(parseMicroVideoOffset('<Camera:MicroVideoOffset>1500</Camera:MicroVideoOffset>'), 1500);
  });

  it('属性形式', () => {
    assert.equal(parseMicroVideoOffset('<x Camera:MicroVideoOffset="1500"/>'), 1500);
  });

  it('缺失返回 null', () => {
    assert.equal(parseMicroVideoOffset('<x></x>'), null);
  });
});

describe('parseMotionPhotoHeader', () => {
  it('解析出 flag / version / declaredVideoLength', () => {
    const bytes = enc.encode(XMP_MODERN);
    const h = parseMotionPhotoHeader(bytes);
    assert.equal(h.motionPhotoFlag, 1);
    assert.equal(h.version, 1);
    assert.equal(h.declaredVideoLength, 1500);
    assert.equal(h.declaredVideoPadding, null);
    assert.equal(h.legacyMicroVideoOffset, null);
  });

  it('无 XMP 返回全 null', () => {
    const h = parseMotionPhotoHeader(enc.encode('nothing'));
    assert.equal(h.motionPhotoFlag, null);
    assert.equal(h.declaredVideoLength, null);
  });

  it('旧标准读出 MicroVideoOffset', () => {
    const h = parseMotionPhotoHeader(enc.encode(XMP_LEGACY));
    assert.equal(h.legacyMicroVideoOffset, 1500);
  });
});

describe('parseMotionPhoto —— 完整文件解析', () => {
  it('新标准（GContainer:Item:Length）识别为 Motion Photo', () => {
    const bytes = buildMotionPhoto({ xmp: XMP_MODERN, stillBytes: 5000, videoBytes: 1500 });
    const info = parseMotionPhoto(bytes);
    assert.equal(info.isMotionPhoto, true);
    assert.equal(info.videoOffset, 5000);
    assert.equal(info.videoLength, 1500);
    assert.equal(info.version, 1);
  });

  it('旧标准（MicroVideoOffset）识别为 Motion Photo', () => {
    const bytes = buildMotionPhoto({ xmp: XMP_LEGACY, stillBytes: 5000, videoBytes: 1500 });
    const info = parseMotionPhoto(bytes);
    assert.equal(info.isMotionPhoto, true);
    assert.equal(info.videoOffset, 5000);
    assert.equal(info.videoLength, 1500);
  });

  it('XMP 声明 MotionPhoto=0 时不识别（标准规定显式否定优先）', () => {
    const xmp = '<x:xmpmeta><Camera:MotionPhoto>0</Camera:MotionPhoto></x:xmpmeta>';
    const bytes = buildMotionPhoto({ xmp, stillBytes: 5000, videoBytes: 1500 });
    const info = parseMotionPhoto(bytes);
    assert.equal(info.isMotionPhoto, false);
    assert.equal(info.videoOffset, null);
  });

  it('XMP 声明长度过期（视频已被剥离）→ 靠尾部 ftyp 兜底', () => {
    // XMP 说视频 999999 字节，但实际只剩 1500
    const bytes = buildMotionPhoto({
      xmp: XMP_MODERN.replace('Item:Length="1500"', 'Item:Length="999999"'),
      stillBytes: 5000,
      videoBytes: 1500,
    });
    const info = parseMotionPhoto(bytes);
    assert.equal(info.isMotionPhoto, true);
    assert.equal(info.videoOffset, 5000);
    assert.equal(info.videoLength, 1500);
  });

  it('XMP 被剥离但尾部有 ftyp → 兜底扫描识别', () => {
    const bytes = buildMotionPhoto({
      xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>',
      stillBytes: 5000,
      videoBytes: 1500,
    });
    const info = parseMotionPhoto(bytes);
    assert.equal(info.isMotionPhoto, true);
    assert.equal(info.videoOffset, 5000);
  });

  it('Item:Padding 参与偏移计算', () => {
    const xmp = XMP_MODERN.replace(
      'Item:Mime="video/mp4" Item:Length="1500"',
      'Item:Mime="video/mp4" Item:Length="1500" Item:Padding="64"'
    );
    const bytes = buildMotionPhoto({ xmp, stillBytes: 5000, videoBytes: 1564 });
    const info = parseMotionPhoto(bytes);
    assert.equal(info.isMotionPhoto, true);
    // offset = total(6564) - length(1500) - padding(64) = 5000
    assert.equal(info.videoOffset, 5000);
  });

  it('普通 JPEG（无 XMP、无尾部 MP4）不识别', () => {
    const bytes = buildMotionPhoto({
      xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>',
      stillBytes: 5000,
      videoBytes: 0,
      includeMfTyp: false,
    });
    const info = parseMotionPhoto(bytes);
    assert.equal(info.isMotionPhoto, false);
  });

  it('空字节数组返回空结果', () => {
    const info = parseMotionPhoto(new Uint8Array(0));
    assert.equal(info.isMotionPhoto, false);
    assert.equal(info.videoOffset, null);
  });
});

describe('parseMotionPhotoFile —— Blob 分片读取（生产调用路径）', () => {
  // 这条用例对应已修的 B1 缺陷：只喂文件头导致 offset 算成负数、检测恒 false。
  it('文件大于 1 MB 时仍能定位视频', async () => {
    const bytes = buildMotionPhoto({ xmp: XMP_MODERN, stillBytes: 3_000_000, videoBytes: 4_000_000 });
    const file = new File([bytes], 'MVIMG_001.jpg', { type: 'image/jpeg' });
    const info = await parseMotionPhotoFile(file);
    assert.equal(info.isMotionPhoto, true);
    assert.equal(info.videoOffset, 3_000_000);
    assert.equal(info.videoLength, 4_000_000);
  });

  it('用文件总长（而非切片长度）倒推：小文件也正确', async () => {
    const bytes = buildMotionPhoto({ xmp: XMP_MODERN, stillBytes: 5000, videoBytes: 1500 });
    const info = await parseMotionPhotoFile(new File([bytes], 'a.jpg'));
    assert.equal(info.isMotionPhoto, true);
    assert.equal(info.videoOffset, 5000);
    assert.equal(info.videoLength, 1500);
  });

  it('XMP 声明长度过期时靠尾部 ftyp 兜底', async () => {
    const bytes = buildMotionPhoto({
      xmp: XMP_MODERN.replace('1500', '999999'),
      stillBytes: 5000,
      videoBytes: 1500,
    });
    const info = await parseMotionPhotoFile(new File([bytes], 'a.jpg'));
    assert.equal(info.isMotionPhoto, true);
    assert.equal(info.videoOffset, 5000);
  });

  it('MotionPhoto=0 显式否定时不兜底', async () => {
    const xmp = '<x:xmpmeta><Camera:MotionPhoto>0</Camera:MotionPhoto></x:xmpmeta>';
    const bytes = buildMotionPhoto({ xmp, stillBytes: 5000, videoBytes: 1500 });
    const info = await parseMotionPhotoFile(new File([bytes], 'a.jpg'));
    assert.equal(info.isMotionPhoto, false);
  });

  it('普通 JPEG 不误判', async () => {
    const bytes = buildMotionPhoto({
      xmp: '<x:xmpmeta></x:xmpmeta>',
      stillBytes: 5000,
      videoBytes: 0,
      includeMfTyp: false,
    });
    const info = await parseMotionPhotoFile(new File([bytes], 'a.jpg'));
    assert.equal(info.isMotionPhoto, false);
  });

  it('空文件返回空结果', async () => {
    const info = await parseMotionPhotoFile(new Blob([]));
    assert.equal(info.isMotionPhoto, false);
  });

  it('与 parseMotionPhoto 结果一致（两条路径不能漂移）', async () => {
    const bytes = buildMotionPhoto({ xmp: XMP_MODERN, stillBytes: 3_000_000, videoBytes: 4_000_000 });
    const sync = parseMotionPhoto(bytes);
    const async = await parseMotionPhotoFile(new Blob([bytes]));
    assert.equal(sync.isMotionPhoto, async.isMotionPhoto);
    assert.equal(sync.videoOffset, async.videoOffset);
    assert.equal(sync.videoLength, async.videoLength);
  });
});

describe('extractMotionPhotoVideo / Still', () => {
  it('剥离出的视频字节数 = videoLength', () => {
    const bytes = buildMotionPhoto({ xmp: XMP_MODERN, stillBytes: 5000, videoBytes: 1500 });
    const info = parseMotionPhoto(bytes);
    const video = extractMotionPhotoVideo(bytes, info);
    assert.ok(video);
    assert.equal(video.length, 1500);
  });

  it('非 Motion Photo 返回 null', () => {
    const bytes = buildMotionPhoto({
      xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>',
      stillBytes: 5000,
      videoBytes: 0,
      includeMfTyp: false,
    });
    const info = parseMotionPhoto(bytes);
    assert.equal(extractMotionPhotoVideo(bytes, info), null);
  });
});

describe('detectEmbeddedVideoCodec', () => {
  it('H.264（avc1）→ 可走零转码快路径', () => {
    const bytes = buildMotionPhoto({
      xmp: XMP_MODERN, stillBytes: 5000, videoBytes: 1500, videoCodec: 'avc1',
    });
    const info = parseMotionPhoto(bytes);
    const video = extractMotionPhotoVideo(bytes, info);
    assert.ok(video);
    assert.equal(detectEmbeddedVideoCodec(video), 'avc1');
    assert.equal(isBrowserNativeCodec('avc1'), true);
  });

  it('HEVC（hvc1）→ 需要转码', () => {
    const bytes = buildMotionPhoto({
      xmp: XMP_MODERN, stillBytes: 5000, videoBytes: 1500, videoCodec: 'hvc1',
    });
    const info = parseMotionPhoto(bytes);
    const video = extractMotionPhotoVideo(bytes, info);
    assert.ok(video);
    assert.equal(detectEmbeddedVideoCodec(video), 'hvc1');
    assert.equal(isBrowserNativeCodec('hvc1'), false);
  });

  it('AV1（av01）→ 需要转码', () => {
    const bytes = buildMotionPhoto({
      xmp: XMP_MODERN, stillBytes: 5000, videoBytes: 1500, videoCodec: 'av01',
    });
    const info = parseMotionPhoto(bytes);
    const video = extractMotionPhotoVideo(bytes, info);
    assert.ok(video);
    assert.equal(detectEmbeddedVideoCodec(video), 'av01');
  });

  it('探测失败返回 null（按需转码处理，安全侧）', () => {
    assert.equal(detectEmbeddedVideoCodec(new Uint8Array(64)), null);
    assert.equal(isBrowserNativeCodec(null), false);
  });
});

describe('needsMotionPhotoTranscode', () => {
  it('Motion Photo 且有视频 → true', () => {
    const bytes = buildMotionPhoto({ xmp: XMP_MODERN, stillBytes: 5000, videoBytes: 1500 });
    const info = parseMotionPhoto(bytes);
    assert.equal(needsMotionPhotoTranscode(info), true);
  });

  it('非 Motion Photo → false', () => {
    const info = parseMotionPhoto(new Uint8Array(0));
    assert.equal(needsMotionPhotoTranscode(info), false);
  });
});

describe('locateVideoInFullBytes', () => {
  it('Ultra HDR 三项目录下精确定位视频起点', () => {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
      <rdf:Description rdf:about=""
        xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
        xmlns:GContainer="http://ns.google.com/photos/1.0/container/"
        Camera:MotionPhoto="1">
        <GContainer:Directory><rdf:Seq>
          <rdf:li><GContainer:Item Item:Mime="image/jpeg" Item:Length="5000"/></rdf:li>
          <rdf:li><GContainer:Item Item:Mime="image/jpeg" Item:Length="200"/></rdf:li>
          <rdf:li><GContainer:Item Item:Mime="video/mp4" Item:Length="1500"/></rdf:li>
        </rdf:Seq></GContainer:Directory>
      </rdf:Description></x:xmpmeta>`;
    const bytes = buildMotionPhoto({ xmp, stillBytes: 5000, videoBytes: 1500 });
    const loc = locateVideoInFullBytes(bytes);
    assert.equal(loc.offset, 5000);
    assert.equal(loc.length, 1500);
  });
});
