// 请求超时预算（纯函数，零依赖，可进 node --test）。
//
// 【为什么单独成模块】线性放大公式原先在 api.ts（uploadImage / uploadMediaBinary）
// 与 mediaS3Api.ts（putMediaS3Object）各写一份，三处必须同语义却无人锁死；
// 而 api.ts 值导入 constants.ts（读 import.meta.env 且缺 .ts 后缀），在
// node --experimental-strip-types 下无法加载，公式写在里面就写不出单测
// （AGENTS.md §9「缺 .ts 后缀的值导入让模块无法加载，从而没有测试」）。
// 抽成零依赖模块后，web 测试链路可直接执行本文件。
//
// 【与 worker 侧的关系】uploadTimeoutMs 的基准值必须 ≥ Worker 处理同一请求的
// 最坏耗时：Worker 在响应前会打 GitHub（子请求超时上限
// GH_FETCH_TIMEOUT_MS=15s，见 cloudflare-worker/src/services/github.ts），
// 前端预算若低于它会「前端先 Abort、Worker 其实还在正常工作」。
// 30s 基准 = 15s 子请求上限的两轮余量。

/** 上传类请求的固定基准（ms） */
export const UPLOAD_TIMEOUT_BASE_MS = 30_000;

/** 每 MB 追加的预算（ms）—— 6s/MB ≈ 隐含 1.33Mbps 上行，覆盖手机 4G 弱信号 */
export const UPLOAD_TIMEOUT_PER_MB_MS = 6_000;

/** 上传类请求的超时上限（ms），防死循环 */
export const UPLOAD_TIMEOUT_MAX_MS = 900_000;

/**
 * 按体积线性放大上传超时。
 * @param byteSize 实际请求体字节数（base64 端点传 base64 字符数 ≈ 传输字节数）
 */
export function uploadTimeoutMs(byteSize: number): number {
  const size = Number.isFinite(byteSize) && byteSize > 0 ? byteSize : 0;
  const mb = size / (1024 * 1024);
  return Math.min(UPLOAD_TIMEOUT_BASE_MS + mb * UPLOAD_TIMEOUT_PER_MB_MS, UPLOAD_TIMEOUT_MAX_MS);
}

/**
 * getTree 的超时（ms）。
 *
 * filename 模式单独放宽：Worker 侧该模式要串行「2 次 commits 列表 + 最多 30 次
 * commit 详情」扇出才产出响应（见 github.ts getTree 的 mode==='filename' 分支），
 * 用默认 10s 会在 Worker 正常工作时被前端先行 Abort，表现为「打开媒体库即
 * 请求超时，请检查网络后重试」（2026-11-03 诊断）。
 * 35s ≈ 子请求上限 15s 的两轮余量；树缓存（CACHE_KV）命中时远低于此。
 */
export const TREE_PLAIN_TIMEOUT_MS = 10_000;
export const TREE_FILENAME_TIMEOUT_MS = 35_000;

/** 按 getTree 的 mode 取超时 */
export function treeTimeoutMs(mode?: 'filename'): number {
  return mode === 'filename' ? TREE_FILENAME_TIMEOUT_MS : TREE_PLAIN_TIMEOUT_MS;
}
