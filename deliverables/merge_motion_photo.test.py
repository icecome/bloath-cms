#!/usr/bin/env python3
"""merge_motion_photo.py 的单元测试（stdlib only，无 pytest 依赖）。

运行：python3 merge_motion_photo.test.py
退出码 0 = 全部通过。CI / 本地均可直接执行。

定位：修复审查项 m-03 / Q-01——双端算法（TS 为基准）此前只有一次性手动
验证，Python 漂移无机制保障。本测试锁定以下与 TS 端
（web/src/lib/motionPhotoMerge.test.ts）完全一致的夹具与断言：
  · 属性形式 / 元素形式 / 改写前缀（I:）三种 XMP 形态的 Length 修补
  · Ultra HDR 三项目录只改 video/ 项
  · fail-closed：无视频项 / 无 XMP / offset 非法 / 空视频一律抛错
  · 合成结果 = 主图（修补后）+ 新视频，字节级断言
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merge_motion_photo as m  # noqa: E402

XMP_MODERN = """<x:xmpmeta xmlns:x="adobe:ns:meta/">
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
</x:xmpmeta>"""

XMP_ULTRA_HDR = XMP_MODERN.replace(
    'Item:Mime="video/mp4" Item:Length="1500"',
    'Item:Mime="image/jpeg" Item:Length="800"/></rdf:li>\n'
    '          <rdf:li><GContainer:Item Item:Mime="video/mp4" Item:Length="1500"',
)

XMP_CUSTOM_PREFIX = XMP_MODERN.replace("GContainer:", "I:").replace("GContainer:", "I:")


def build_still(xmp: str, still_size: int) -> bytes:
    head = bytes([0xFF, 0xD8, 0xFF, 0xE0])
    xmp_bytes = xmp.encode("utf-8")
    buf = bytearray(still_size)
    buf[0:4] = head
    buf[4:4 + len(xmp_bytes)] = xmp_bytes
    return bytes(buf)


def build_video(size: int) -> bytes:
    v = bytearray(size)
    if size >= 12:
        v[0:12] = bytes([0, 0, 0, 0x20]) + b"ftyp" + b"isom"
    return bytes(v)


def build_full(xmp: str, still_size: int, old_video_size: int):
    return build_still(xmp, still_size) + build_video(old_video_size), still_size


_passed = 0
_failed = 0


def check(name, cond):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ok - {name}")
    else:
        _failed += 1
        print(f"  FAIL - {name}")


def check_raises(name, fn):
    global _passed, _failed
    try:
        fn()
        _failed += 1
        print(f"  FAIL - {name} (expected exception)")
    except (m.ValueError if hasattr(m, "ValueError") else ValueError, Exception) as exc:
        # merge_motion_photo 抛的是内置 ValueError
        if isinstance(exc, (ValueError,)):
            _passed += 1
            print(f"  ok - {name}")
        else:
            _failed += 1
            print(f"  FAIL - {name} (unexpected exception type: {type(exc).__name__})")


import re  # noqa: E402  (放底部以保持顶部 import 集中可见)


def main():
    print("patch_xmp_video_length:")
    out = m.patch_xmp_video_length(XMP_MODERN, 2222)
    check("修补视频项 Length，保留图片项不变",
          'Item:Length="2222"' in out and 'Item:Mime="image/jpeg" Item:Length="5000"' in out)

    out = m.patch_xmp_video_length(XMP_ULTRA_HDR, 3333)
    check("Ultra HDR：只改 video/ 项，不动 gainmap",
          out.count('Item:Length="5000"') == 1 and out.count('Item:Length="800"') == 1
          and 'Item:Length="3333"' in out)

    out = m.patch_xmp_video_length(XMP_CUSTOM_PREFIX, 4444)
    check("改写前缀形态（I:）同样命中",
          'I:Length="4444"' in out or 'Item:Length="4444"' in out)

    no_video = XMP_MODERN.replace('Item:Mime="video/mp4" Item:Length="1500"',
                                  'Item:Mime="image/jpeg" Item:Length="1500"')
    check_raises("无视频项时 fail-closed 抛错",
                 lambda: m.patch_xmp_video_length(no_video, 100))
    check_raises("无 XMP 的文本抛错",
                 lambda: m.patch_xmp_video_length("no xmp", 100))

    # 无前缀元素形式（m-02 修复验证）
    xmp_elem = ('<x:xmpmeta><GContainer:Directory xmlns:GContainer="u"><rdf:Seq xmlns:rdf="r">'
                '<li><Item><Mime>video/mp4</Mime><Length>1500</Length></Item>'
                "</li></rdf:Seq></GContainer:Directory></x:xmpmeta>")
    out = m.patch_xmp_video_length(xmp_elem, 2000)
    check("无前缀元素形式命中（m-02 双端一致性）", "<Length>2000</Length>" in out)

    print("merge:")
    still_size, old_video_size = 5000, 1500
    full, offset = build_full(XMP_MODERN, still_size, old_video_size)
    new_video = build_video(2000)
    out = m.merge(full, offset, new_video)

    check("合成结果总长 = 主图 + 新视频", len(out) == still_size + len(new_video))
    text = out[:still_size].decode("latin-1")
    match = re.search(r'video/mp4" Item:Length="(\d+)"', text)
    check("XMP 声明长度 = 新视频长度", match is not None and match.group(1) == str(len(new_video)))
    check("尾部是新视频字节", out[still_size:still_size + 12] == new_video[:12])
    check("JPEG 头保持不变", out[:4] == bytes([0xFF, 0xD8, 0xFF, 0xE0]))

    # 旧视频残留检查：在旧视频区打标记
    full_marked = bytearray(full)
    for i in range(still_size, len(full_marked)):
        full_marked[i] = 0xAB
    out = m.merge(bytes(full_marked), offset, new_video)
    check("原视频尾部被完全丢弃", 0xAB not in out)

    # Length 位数变化自洽（"1500" → "9"）
    full, offset = build_full(XMP_MODERN, still_size, old_video_size)
    out = m.merge(full, offset, build_video(9))
    text = out[:still_size].decode("latin-1")
    match = re.search(r'video/mp4" Item:Length="(\d+)"', text)
    check("Length 数字位数变化时声明自洽", match is not None and match.group(1) == "9")

    check_raises("offset 非法抛错（=0）", lambda: m.merge(full, 0, build_video(100)))
    check_raises("offset 非法抛错（越界）", lambda: m.merge(full, len(full) + 10, build_video(100)))
    no_xmp = bytearray(still_size + old_video_size)
    no_xmp[0:4] = bytes([0xFF, 0xD8, 0xFF, 0xE0])
    check_raises("无 XMP 主图抛错", lambda: m.merge(bytes(no_xmp), still_size, build_video(100)))
    check_raises("空视频抛错", lambda: m.merge(full, still_size, b""))

    print(f"\n{_passed} passed, {_failed} failed")
    sys.exit(1 if _failed else 0)


if __name__ == "__main__":
    main()
