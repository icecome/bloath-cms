// Motion Photo（安卓动态照片）视频转码执行层。
//
// 与纯逻辑层（motionPhoto.ts）的分界：本模块碰 DOM 与外部二进制依赖，
// 不进 node --test，因此拆开。
//
// 技术路线：ffmpeg.wasm（@ffmpeg/ffmpeg + @ffmpeg/core）
//   为什么不用 WebCodecs：小米等机型内嵌视频编码为 HEVC（H.265）为主，
//   浏览器 VideoDecoder 对 HEVC 的支持极不稳定（Chrome 桌面版长期缺 HEVC，
//   仅部分带硬件解码的机器可用；Firefox 不支持）。WebCodecs 路线在多数
//   桌面环境下直接不可用。ffmpeg.wasm 自带完整软解码，HEVC/AV1/H.264 通吃，
//   输出统一为 H.264 + AAC / MP4——这是「保证能播放」的最稳路径。
//
//   注意：H.264 内嵌的视频走「零转码快路径」（见 motionPhotoTranscode 的
//   remuxOnly 分支），完全不加载 ffmpeg。只有 HEVC/AV1 才需要本模块。
//
// 体积与托管：ffmpeg.wasm core 约 31 MB，超过 Cloudflare Pages 单文件
// 25 MiB 上限（已实测），因此不能放进 web/public/。改用 jsDelivr 托管
// @ffmpeg/core@0.12.10/dist/esm —— ESM 版（worker 是 module worker，
// UMD 版无法被 await import() 取到 default export，会抛 ERROR_IMPORT_FAILURE）。
//
// 【本模块的四条硬约束（踩坑换来的，勿改回去）】
// 1. 单例 Promise 失败必须重置。否则一次网络抖动会让 rejected payload
//    被永久缓存，整个会话再无法转码（与 LazyRoute 已修过的缺陷同构）。
// 2. exec 必须查返回码。返回 1 时若不抛错，后续 readFile 会读到上一次
//    残留的 output.mp4，把旧视频当新视频上传——静默数据错误。
// 3. progress 监听器用完必须 off()。批量上传时多个闭包同时触发，进度串台。
// 4. 同一 ffmpeg 实例不能并发 exec，更不能共用同一个 input.mp4 路径。
//    因此所有 exec 走串行队列（MediaPage 的图片并发不受影响）。
//
// 输出规格（保证浏览器可播）：
//   · 视频：H.264（avc1）High@4.0，yuv420p，偶数尺寸
//   · 音频：AAC-LC
//   · 容器：MP4，+faststart（moov 前置，流式播放必备）
//   · -map_metadata -1：Motion Photo 视频常带 GPS 坐标，转码后不应
//     原样带到公开博客上
//   · 短边不超过 720，时长不超过 15s（动态照片视频通常 1–3s）

import type { MotionPhotoInfo } from './motionPhoto.ts';

/** 懒加载单例：整个会话只初始化一次 ffmpeg.wasm */
let ffmpegInstance: Promise<FfmpegLike> | null = null;

/**
 * ffmpeg.wasm 的事件回调签名在 0.12.x 的类型定义里是 (...args: unknown[]) => void，
 * 直接用具体参数类型会不兼容。这里统一用宽松签名再在内部断言。
 */
type FfmpegEventHandler = (...args: unknown[]) => void;

/** 本模块用到的 ffmpeg 实例能力（避开官方类型里未声明的 off） */
interface FfmpegLike {
  on: (event: string, cb: FfmpegEventHandler) => void;
  off: (event: string, cb: FfmpegEventHandler) => void;
  exec: (args: string[], timeout?: number, options?: { signal?: AbortSignal }) => Promise<number>;
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<unknown>;
  load: (config: { coreURL: string; wasmURL: string }) => Promise<boolean>;
}

/** ffmpeg.wasm core 托管地址（jsDelivr，版本锁死 + 自带 CORS） */
const CORE_BASE = 'https://testingcf.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

/** 输出规格常量（转码参数集中一处，便于调整） */
export const TRANSCODE_OUTPUT = {
  /** 输出短边上限（等比缩放，不放大） */
  maxShortSide: 720,
  /** 输出时长上限（秒） */
  maxDurationSec: 15,
  /** H.264 质量（ffmpeg 默认值，越小越清晰） */
  crf: 23,
  preset: 'veryfast',
  audioBitrate: '128k',
} as const;

export interface TranscodeProgress {
  stage: 'loading' | 'transcoding' | 'done';
  /** 0..1 */
  ratio: number;
}

export interface TranscodeResult {
  blob: Blob;
  /** 输出文件名（.mp4） */
  fileName: string;
  /** 源体积（字节） */
  sourceBytes: number;
  /** 输出体积（字节） */
  outputBytes: number;
}

/**
 * 确保 ffmpeg.wasm 已加载（懒加载 + 单例 + 失败重置）。
 */
async function ensureFFmpeg(
  onProgress?: (p: TranscodeProgress) => void
): Promise<FfmpegLike> {
  if (!ffmpegInstance) {
    onProgress?.({ stage: 'loading', ratio: 0 });
    // 动态 import：core 不在主包里，只有走到这里才下载
    ffmpegInstance = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = new FFmpeg() as unknown as FfmpegLike;
      // 日志级别降噪：ffmpeg.wasm 默认会打印大量帧信息
      ffmpeg.on('log', () => {});
      // 单线程 core：多线程版需要 SharedArrayBuffer（要求 COOP/COEP 响应头），
      // Cloudflare Pages 静态站点无法保证，因此用单线程版换取零配置可用性。
      // ESM 版是必需的：worker 是 module worker，UMD 版 import 后 .default 为 undefined。
      await ffmpeg.load({
        coreURL: `${CORE_BASE}/ffmpeg-core.js`,
        wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
      });
      return ffmpeg;
    })().catch((err: unknown) => {
      // 失败必须重置：否则 rejected payload 被永久缓存，会话内再也无法转码
      ffmpegInstance = null;
      throw err;
    });
  }
  const ffmpeg = await ffmpegInstance;
  onProgress?.({ stage: 'loading', ratio: 1 });
  return ffmpeg;
}

// ---------------------------------------------------------------------------
// 串行队列：同一 ffmpeg 实例不能并发 exec，且不能共用 input.mp4
// ---------------------------------------------------------------------------

let transcodeQueue: Promise<unknown> = Promise.resolve();

/** 把转码任务串行化。任一任务失败不影响队列后续执行。 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = transcodeQueue.then(task, task);
  // 队列本身不因单个任务失败而中断
  transcodeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** 生成带序号的临时文件名，避免任何可能的路径撞车 */
let fileSeq = 0;
function tempPaths(): { input: string; output: string } {
  fileSeq += 1;
  return { input: `in_${fileSeq}.mp4`, output: `out_${fileSeq}.mp4` };
}

// ---------------------------------------------------------------------------
// 转码参数
// ---------------------------------------------------------------------------

/**
 * 构造 ffmpeg 参数。
 *
 * 两条路径：
 *   · remuxOnly：源已是 H.264 → 只换容器（`-c copy`），毫秒级、零重编码、无损
 *   · 完整转码：HEVC/AV1 → H.264 + AAC
 *
 * scale 表达式必须按**短边**约束：`min(720,iw)` 会把 1920×1080 压成 720×405
 * （短边只剩 405）。正确写法是「长边等比缩放，短边 clamp 到 720」。
 */
function buildArgs(
  inputName: string,
  outputName: string,
  remuxOnly: boolean
): string[] {
  const { maxShortSide, maxDurationSec, crf, preset, audioBitrate } = TRANSCODE_OUTPUT;

  // 短边约束：宽>高时宽随 iw 缩放、高 clamp 到 maxShortSide；反之镜像
  const scale = `scale='if(gt(iw,ih),-2,${maxShortSide})':'if(gt(iw,ih),${maxShortSide},-2)'`;

  const common = [
    '-i', inputName,
    '-movflags', '+faststart',
    '-t', String(maxDurationSec),
    // Motion Photo 视频常带 GPS 等元数据，转码后不应带到公开博客
    '-map_metadata', '-1',
    '-vn_metadata', '-1',
  ];

  if (remuxOnly) {
    // 零重编码：流复制 + 换容器。不重采样、不缩放、不改写音视频轨。
    return [
      '-i', inputName,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      '-t', String(maxDurationSec),
      outputName,
    ];
  }

  return [
    ...common,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    // 显式声明 profile/level，与 avc1.640028 声明一致；iOS Safari 对此敏感
    '-profile:v', 'high',
    '-level:v', '4.0',
    '-vf', `${scale},format=yuv420p`,
    '-c:a', 'aac',
    '-b:a', audioBitrate,
    outputName,
  ];
}

/**
 * 转码单个 Motion Photo 的内嵌视频。
 *
 * @param videoBytes 已从主图剥离的 MP4 字节
 * @param opts.onProgress 进度回调（加载 / 转码）
 */
export async function transcodeMotionPhotoVideo(
  videoBytes: Uint8Array,
  opts?: {
    onProgress?: (p: TranscodeProgress) => void;
  }
): Promise<TranscodeResult> {
  return serialize(() => transcodeInternal(videoBytes, opts));
}

async function transcodeInternal(
  videoBytes: Uint8Array,
  opts?: {
    onProgress?: (p: TranscodeProgress) => void;
  }
): Promise<TranscodeResult> {
  const ffmpeg = await ensureFFmpeg(opts?.onProgress);
  const { fetchFile } = await import('@ffmpeg/util');

  const { input: inputName, output: outputName } = tempPaths();
  await ffmpeg.writeFile(inputName, await fetchFile(new Blob([videoBytes as BlobPart])));

  // progress 监听器：用完必须 off，否则批量上传时多个闭包同时触发、进度串台
  const onProgressEvent: FfmpegEventHandler = (...args: unknown[]) => {
    const evt = args[0] as { progress?: number } | undefined;
    if (evt && typeof evt.progress === 'number') {
      opts?.onProgress?.({
        stage: 'transcoding',
        ratio: Math.min(1, Math.max(0, evt.progress)),
      });
    }
  };
  ffmpeg.on('progress', onProgressEvent);

  const args = buildArgs(inputName, outputName, false);

  let code: number;
  try {
    code = await ffmpeg.exec(args);
  } finally {
    ffmpeg.off('progress', onProgressEvent);
  }

  // 查返回码：不查会读到上一次残留的 output.mp4，把旧视频当新视频上传
  if (code !== 0) {
    await safeDelete(ffmpeg, inputName);
    throw new Error(`ffmpeg 转码失败（exit ${code}）`);
  }

  const data = await ffmpeg.readFile(outputName);
  if (typeof data === 'string') {
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
    throw new Error('ffmpeg 输出读取失败');
  }

  const blob = new Blob([data as BlobPart], { type: 'video/mp4' });

  // 清理虚拟文件系统，避免多次上传时占满内存
  await safeDelete(ffmpeg, inputName);
  await safeDelete(ffmpeg, outputName);

  opts?.onProgress?.({ stage: 'done', ratio: 1 });

  return {
    blob,
    fileName: outputName,
    sourceBytes: videoBytes.length,
    outputBytes: blob.size,
  };
}

async function safeDelete(ffmpeg: FfmpegLike, path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // 清理失败不影响结果
  }
}

/**
 * 便捷入口：从 Motion Photo 原文件字节直接得到转码后的视频 Blob。
 * 内部完成「剥离 → 转码」两步。
 */
export async function transcodeMotionPhotoFile(
  fileBytes: Uint8Array,
  info: MotionPhotoInfo,
  opts?: { onProgress?: (p: TranscodeProgress) => void }
): Promise<TranscodeResult> {
  if (!info.isMotionPhoto || info.videoOffset === null) {
    throw new Error('不是有效的 Motion Photo 文件');
  }
  const videoBytes = fileBytes.slice(
    info.videoOffset,
    info.videoOffset + (info.videoLength ?? 0)
  );
  return transcodeMotionPhotoVideo(videoBytes, opts);
}
