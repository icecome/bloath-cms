#!/usr/bin/env python3
"""动态照片单文件合成脚本（图床 workflow 调用）。

与 CMS 端 web/src/lib/motionPhotoMerge.ts 是**同一算法的两套实现**，
行为必须一致（该文件是本脚本的算法基准与测试参照）。

职责：
  · 输入：主图源 <base>.src.jpg（含旧 HEVC 视频尾巴）、已转码的 H.264 视频、
          视频起始偏移（来自 <base>.motion.json，或命令行 --offset）
  · 输出：<base>.jpg = 主图字节（截断旧视频）+ 修补后的 XMP + 新 H.264 视频
  · fail-closed：定位不到 XMP / 找不到视频项 / offset 非法时，保留源文件退出非零，
    绝不产出坏文件（workflow 会因此保留 .src.* 等 cron 下一轮重试）

算法要点（与 motionPhotoMerge.ts 一致）：
  1. 用 latin-1 读主图 [0, offset) 区间，定位 <x:xmpmeta>...</x:xmpmeta>
     （latin-1 下「字符下标 == 字节下标」，与 JS 端 1:1 对应）
  2. 在 XMP 内定位 Container 目录中 Mime 为 video/ 的 Item，
     把它的 Length 改成新视频字节数、Padding 归零
     （属性形式与元素形式都支持；匹配 local name，不写死前缀）
  3. 拼接：主图头 + 修补后的 XMP 区段 + 主图其余部分 + 新视频

用法：
  python3 merge_motion_photo.py --still <base>.src.jpg --video tmp.mp4 \
      --offset 2845213 --out <base>.jpg
"""
import argparse
import json
import os
import re
import sys

XMP_START = b"<x:xmpmeta"
XMP_END = b"</x:xmpmeta>"


def locate_xmp(blob: bytes):
    """返回 (start, end) 字节区间（左闭右开）；找不到返回 None。"""
    start = blob.find(XMP_START)
    if start < 0:
        return None
    end = blob.find(XMP_END, start)
    if end < 0:
        return None
    return start, end + len(XMP_END)


def patch_xmp_video_length(xmp_text: str, video_length: int) -> str:
    """修补 XMP 中视频项（Mime=video/*）的 Length/Padding。找不到则抛 ValueError。"""
    # 1. 属性形式：<X:Item Item:Mime="video/mp4" Item:Length="1500" .../>
    item_tag = re.compile(r"<([A-Za-z_][\w.-]*:)?Item\b([^>]*?)/?>")
    patched = [False]

    def repl(m):
        attrs = m.group(2)
        if not re.search(r"(?:[A-Za-z_][\w.-]*:)?Mime\s*=\s*[\"']video/", attrs, re.I):
            return m.group(0)
        patched[0] = True
        new = re.sub(
            r"((?:[A-Za-z_][\w.-]*:)?Length\s*=\s*[\"'])\d+([\"'])",
            lambda mm: f"{mm.group(1)}{video_length}{mm.group(2)}",
            attrs,
            flags=re.I,
        )
        new = re.sub(
            r"((?:[A-Za-z_][\w.-]*:)?Padding\s*=\s*[\"'])\d+([\"'])",
            r"\g<1>0\g<2>",
            new,
            flags=re.I,
        )
        if not re.search(r"(?:[A-Za-z_][\w.-]*:)?Length\s*=", new, re.I):
            new = re.sub(r"/?>$", ' Item:Length="%d"\\g<0>' % video_length, new)
        return m.group(0).replace(attrs, new)

    out = item_tag.sub(repl, xmp_text)

    if not patched[0]:
        # 2. 元素形式兜底：<X:Item ...><X:Mime>video/mp4</X:Mime><X:Length>123</X:Length></X:Item>
        # 闭合标签与 TS 端 (motionPhotoMerge.patchXmpVideoLength) 对齐：
        # </(?:\2)?Item> —— group2 为可选前缀，无前缀 <Item>...</Item> 同样可匹配
        elem = re.compile(
            r"(<([A-Za-z_][\w.-]*:)?Item\b[^>]*>)([\s\S]*?)(</(?:\2)?Item>)"
        )

        def repl2(m):
            inner = m.group(3)
            if not re.search(r"<(?:[A-Za-z_][\w.-]*:)?Mime\b[^>]*>\s*video/", inner, re.I):
                return m.group(0)
            patched[0] = True
            new = re.sub(
                r"(<(?:[A-Za-z_][\w.-]*:)?Length\b[^>]*>)\d+(</(?:[A-Za-z_][\w.-]*:)?Length>)",
                lambda mm: f"{mm.group(1)}{video_length}{mm.group(2)}",
                inner,
                flags=re.I,
            )
            new = re.sub(
                r"(<(?:[A-Za-z_][\w.-]*:)?Padding\b[^>]*>)\d+(</(?:[A-Za-z_][\w.-]*:)?Padding>)",
                r"\g<1>0\g<2>",
                new,
                flags=re.I,
            )
            return m.group(1) + new + m.group(4)

        out = elem.sub(repl2, out)

    if not patched[0]:
        raise ValueError("XMP Container 目录中未找到视频项，放弃合成")
    return out


def merge(still_bytes: bytes, video_offset: int, new_video: bytes) -> bytes:
    if not (1024 < video_offset < len(still_bytes)):
        raise ValueError(f"videoOffset 非法：{video_offset}（总长 {len(still_bytes)}）")
    if len(new_video) == 0:
        raise ValueError("新视频为空，放弃合成")

    head = still_bytes[:video_offset]
    text = head.decode("latin-1")  # 字节 <-> 字符 1:1
    span = locate_xmp(head)
    if span is None:
        raise ValueError("主图字节中未找到 XMP 包，放弃合成")
    start, end = span
    if end > video_offset:
        raise ValueError("XMP 区间越过视频起点，定位异常，放弃合成")

    patched_text = patch_xmp_video_length(text[start:end], len(new_video))
    patched_bytes = patched_text.encode("latin-1")  # 字节保真写回（非 UTF-8）

    delta = len(patched_bytes) - (end - start)
    total = video_offset + delta + len(new_video)
    out = bytearray(total)
    pos = 0
    out[pos:pos + start] = head[:start]; pos += start
    out[pos:pos + len(patched_bytes)] = patched_bytes; pos += len(patched_bytes)
    out[pos:pos + (video_offset - end)] = head[end:video_offset]; pos += video_offset - end
    out[pos:pos + len(new_video)] = new_video
    return bytes(out)


def scan_trailing_ftyp_offset(blob: bytes):
    """兜底：从尾部 32MB 窗口扫描 MP4 ftyp box 头（与 JS 端 scanTrailingMp4Offset 同规则）。

    仅当清单缺失/畸形时使用。返回视频起始偏移（相对文件开头），找不到返回 None。
    """
    window = min(len(blob), 32 * 1024 * 1024)
    tail = blob[len(blob) - window:]
    i = 0
    while i + 8 < len(tail):
        if tail[i + 4:i + 8] == b"ftyp":
            offset = len(blob) - window + i
            if 1024 < offset < len(blob) - 8:
                return offset
            return None
        i += 4
    return None


def resolve_offset(manifest_path, still: bytes, fallback):
    """offset 解析顺序：清单 → 命令行参数 → 尾部 ftyp 扫描兜底。

    与 CMS 端 parseMotionPhotoFile 的策略同构（XMP 声明优先、魔数兜底）——
    清单缺失不应让合成直接失败，这是「清单不是单点依赖」的兜底实现。
    """
    if manifest_path and os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            off = data.get("videoOffset")
            if isinstance(off, int) and off > 1024:
                return off
        except (ValueError, OSError):
            pass
    if fallback and fallback > 1024:
        return fallback
    scanned = scan_trailing_ftyp_offset(still)
    if scanned is not None:
        print(f"::warning::manifest offset unavailable, scanned ftyp at {scanned}")
        return scanned
    raise ValueError("无法确定 videoOffset（清单缺失且 ftyp 扫描失败），放弃合成")


def main():
    ap = argparse.ArgumentParser(description="合成单文件 Motion Photo")
    ap.add_argument("--still", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--offset", type=int, required=True)
    ap.add_argument("--manifest", default=None)
    args = ap.parse_args()

    with open(args.still, "rb") as fh:
        still = fh.read()
    with open(args.video, "rb") as fh:
        video = fh.read()

    offset = resolve_offset(args.manifest, still, args.offset)

    merged = merge(still, offset, video)
    with open(args.out, "wb") as fh:
        fh.write(merged)
    print(f"merged: {args.still} + {args.video} -> {args.out} "
          f"({len(still)}+{len(video)} -> {len(merged)} bytes)")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as exc:
        print(f"::error::merge failed: {exc}", file=sys.stderr)
        sys.exit(1)
