// 动态照片合成指令清单（1.motion.json）的构造与解析。
//
// 【为什么存在】服务端转码路径下，workflow 需要知道「这两个 .src 文件合成哪个 .jpg、
// 视频起点在哪」。上传侧已经跑过 parseMotionPhotoFile 拿到 videoOffset/Length，
// 写进清单传给 workflow，避免 workflow 用 Python 重写一遍 XMP 解析（双端漂移）。
//
// 【消费方】
//   · 图床 workflow（merge_motion_photo.py）：读 stillSource/videoSource/output/videoOffset
//   · CMS 列表层：按文件名识别清单文件并从展示中剔除（isMotionManifestName）
//
// 【契约】文件名 <baseName>.motion.json 与 workflow 的扫描规则互为契约，
// 改任一侧必须同步（workflow 顶部注释 + 本模块常量）。
//
// 【校验说明】web 无 zod 依赖，这里手写结构校验（等价 safeParse 语义）：
// 返回 null 而不是抛错，调用方对畸形清单按「缺失」处理（workflow 有 ftyp 兜底扫描，
// 清单不是单点依赖——见设计方案 §6）。

/** 清单固定文件名后缀（<baseName>.motion.json） */
export const MOTION_MANIFEST_SUFFIX = '.motion.json';

/** 清单格式版本（结构不兼容时递增） */
export const MOTION_MANIFEST_VERSION = 1 as const;

/** 合成指令清单（上传侧写入、workflow 消费） */
export interface MotionManifest {
  v: typeof MOTION_MANIFEST_VERSION;
  type: 'motion-photo-merge';
  /** 主图源文件名（<baseName>.src.jpg） */
  stillSource: string;
  /** 视频源文件名（<baseName>.src.mp4） */
  videoSource: string;
  /** 成品文件名（<baseName>.jpg） */
  output: string;
  /** 原内嵌视频起始偏移（字节，parseMotionPhotoFile 结果） */
  videoOffset: number;
  /** 原内嵌视频长度（字节） */
  videoLength: number;
  /** 静态图在视频中的呈现时刻（微秒），缺失为 null */
  presentationTimestampUs: number | null;
  createdAt: string;
}

/** 是否为清单文件名（用于列表过滤；大小写不敏感） */
export function isMotionManifestName(name: string): boolean {
  return name.toLowerCase().endsWith(MOTION_MANIFEST_SUFFIX);
}

/** 是否为动态照片主图源文件名（<baseName>.src.jpg） */
export function isMotionStillSourceName(name: string): boolean {
  return /\.src\.jpe?g$/i.test(name);
}

/** 由 baseName 得到清单文件名 */
export function motionManifestName(baseName: string): string {
  return `${baseName}${MOTION_MANIFEST_SUFFIX}`;
}

/** 由清单名/源文件名反推 baseName；非动态照片家族文件名返回 null */
export function motionBaseNameOf(name: string): string | null {
  const lower = name.toLowerCase();
  // .src.jpg / .src.jpeg：剥掉两段（.src + 扩展名）
  if (lower.endsWith('.src.jpg')) return name.slice(0, -'.src.jpg'.length);
  if (lower.endsWith('.src.jpeg')) return name.slice(0, -'.src.jpeg'.length);
  if (lower.endsWith('.src.mp4')) return name.slice(0, -'.src.mp4'.length);
  if (isMotionManifestName(name)) return name.slice(0, -MOTION_MANIFEST_SUFFIX.length);
  return null;
}

/**
 * 构造清单对象（纯函数，不落盘）。
 * @param baseName 已清洗的文件基础名（不含扩展名）
 */
export function buildMotionManifest(
  baseName: string,
  info: { videoOffset: number; videoLength: number; presentationTimestampUs?: number | null }
): MotionManifest {
  return {
    v: MOTION_MANIFEST_VERSION,
    type: 'motion-photo-merge',
    stillSource: `${baseName}.src.jpg`,
    videoSource: `${baseName}.src.mp4`,
    output: `${baseName}.jpg`,
    videoOffset: info.videoOffset,
    videoLength: info.videoLength,
    presentationTimestampUs: info.presentationTimestampUs ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 解析并校验清单文本。
 * @returns 合法清单对象；任何结构/类型不符返回 null（调用方按缺失处理）
 */
export function parseMotionManifest(text: string): MotionManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (o['v'] !== MOTION_MANIFEST_VERSION) return null;
  if (o['type'] !== 'motion-photo-merge') return null;
  if (typeof o['stillSource'] !== 'string' || !o['stillSource']) return null;
  if (typeof o['videoSource'] !== 'string' || !o['videoSource']) return null;
  if (typeof o['output'] !== 'string' || !o['output']) return null;
  if (typeof o['videoOffset'] !== 'number' || !Number.isFinite(o['videoOffset']) || o['videoOffset'] <= 1024) return null;
  if (typeof o['videoLength'] !== 'number' || !Number.isFinite(o['videoLength']) || o['videoLength'] <= 0) return null;
  if (typeof o['createdAt'] !== 'string') return null;

  const ts = o['presentationTimestampUs'];
  if (ts !== null && ts !== undefined && typeof ts !== 'number') return null;

  return {
    v: MOTION_MANIFEST_VERSION,
    type: 'motion-photo-merge',
    stillSource: o['stillSource'],
    videoSource: o['videoSource'],
    output: o['output'],
    videoOffset: o['videoOffset'],
    videoLength: o['videoLength'],
    presentationTimestampUs: (ts as number | null | undefined) ?? null,
    createdAt: o['createdAt'],
  };
}
