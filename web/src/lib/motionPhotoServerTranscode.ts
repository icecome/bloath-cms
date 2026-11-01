// 动态照片内嵌视频的上传策略决策层（纯逻辑，零 DOM/网络依赖，可进 node --test）。
//
// 【为什么存在这个模块】（2026-11-01 架构决策）
// 旧方案：HEVC/AV1 内嵌视频在浏览器里用 ffmpeg.wasm 转码为 H.264。
//   core 30.7 MiB 从第三方 CDN 拉取，实测 testingcf.jsdelivr.net 仅 0.61 MB/s
//   （50 秒起步、无重试），加载慢导致转码从未稳定成功。
// 新方案：转码挪到「有原生 ffmpeg 且保证可用」的地方——图床仓库自己的
//   GitHub Actions（公开仓库免费、runner 预装 ffmpeg）。上传侧把 HEVC 源
//   **原样**上传（零下载、零转码），由 workflow 异步转码，保证成功；
//   代价是 1~2 分钟的转码窗口（窗口内博客只显示静态主图，与旧方案
//   「转码失败只剩静态图」的表现一致，不会更糟）。
//
// 【命名契约】CMS 上传侧与图床仓库 workflow 共同遵守，两侧不可单独修改：
//   · 待转码源：`${baseName}.src.mp4` —— HEVC/AV1 内嵌视频的原始字节
//   · 转码产物：`${baseName}.mp4` —— H.264 + AAC，workflow 产出后删除源文件
//
// 【防循环】
//   · workflow 触发条件按路径 `**/*.src.mp4` 过滤；产物 `.mp4` 不匹配。
//   · workflow 的产出提交信息带 [skip ci]（删除 .src.mp4 的提交仍会命中
//     路径过滤，必须用标记抑制，避免空转触发）。
//   · 上传侧仅在「服务端转码路径」的源文件提交**不带** [skip ci]——
//     该提交正是触发 workflow 的信号；其余派生资产提交照旧带标记。
//
// 【通道差异】S3 后端没有仓库 Actions 可触发，无法走服务端转码，
//   保留浏览器 wasm 转码作为后备路径（见 useMediaUpload 的执行分支）。

/** 待转码源的文件名后缀（与图床仓库 workflow 的匹配模式互为契约） */
export const SERVER_TRANSCODE_SRC_SUFFIX = '.src.mp4';

/** 是否为等待服务端转码的源文件（用于媒体列表过滤与提交信息判定） */
export function isServerTranscodeSource(name: string): boolean {
  return name.toLowerCase().endsWith(SERVER_TRANSCODE_SRC_SUFFIX);
}

/**
 * 由待转码源文件名得到转码产物的落盘文件名；非源文件名原样返回。
 *
 * Q-04 anti-Potemkin 说明：本函数当前只被同目录 .test.ts 引用，暂无生产调用点。
 * 它是「图床 workflow 转码完成、产物 .mp4 回写后」的预留关联函数——媒体列表
 * 与选择器在转码窗口内只展示静态主图（.src.mp4 已被 isServerTranscodeSource
 * 过滤），窗口结束后 workflow 产出 .mp4，此时列表刷新直接按 .mp4 展示即可，
 * 暂不需要把 .mp4 反查回 .src.mp4。保留此函数 + 测试，是为了让「源名 ↔ 产物名」
 * 的命名契约有单一事实来源：未来若要在 UI 上展示「转码中」状态，应消费本函数，
 * 而不是在组件里重新拼写后缀。
 */
export function serverTranscodeOutputName(name: string): string {
  if (!isServerTranscodeSource(name)) return name;
  return `${name.slice(0, -SERVER_TRANSCODE_SRC_SUFFIX.length)}.mp4`;
}

/**
 * 内嵌视频上传策略（纯决策；执行分支在 useMediaUpload）：
 *   · 'native'  —— H.264（avc1/avc3），浏览器原生可播，切片直传，不碰转码器
 *   · 'server'  —— GitHub 通道：HEVC/AV1 原样上传 *.src.mp4，图床 Actions 转码
 *   · 'browser' —— S3 通道：浏览器 wasm 转码（core 30.7 MiB，尽力而为；
 *                  失败时调用方回退为原样上传，不再丢弃动态部分）
 *
 * codec 为 null（未识别出 fourcc）时按「不可播」处理，与
 * motionPhoto.isBrowserNativeCodec(null) === false 的语义一致。
 */
export type EmbeddedVideoStrategy = 'native' | 'server' | 'browser';

export function embeddedVideoStrategy(
  codec: string | null,
  opts: { isS3: boolean }
): EmbeddedVideoStrategy {
  if (codec === 'avc1' || codec === 'avc3') return 'native';
  return opts.isS3 ? 'browser' : 'server';
}
