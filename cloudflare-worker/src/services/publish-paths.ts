// 发布路径解析纯函数：publish 编排与前端构造 CommitOp 共用的语义真源。
//
// 独立成模块的原因：
// 1. publish.service.ts 依赖 github/buffer.service（Cloudflare 运行时链路），
//    无法在 node --experimental-strip-types 的测试环境中加载；
//    本模块零依赖，可被 worker 侧单元测试直接导入。
// 2. 这是 M-R2 修复的语义所在——「move 条目无 target 不得重解析」的规则
//    曾因只存在于注释中而无测试锁定，发生过「同路径先写后删 → 文件丢失」的缺陷。
//    独立模块让规则获得专属测试（publish-ops.test.ts）。

/**
 * 目标目录 + 原文件名 → 发布路径；无目标时保持原路径（降级落草稿目录）。
 *
 * 语义（勿改，改前先读 publish-ops.test.ts）：
 * - publishTarget 为空/null/纯斜杠 → 返回原 path；
 * - 有 target → `${target 去尾斜杠}/${原文件名}`。
 */
export function resolvePublishPath(path: string, publishTarget?: string | null): string {
  if (!publishTarget) return path;
  const name = path.split('/').pop() || path;
  return `${publishTarget.replace(/\/+$/, '')}/${name}`;
}

/**
 * move 操作的目标路径解析（publish.service 专用语义）：
 * move 条目写入缓冲时 path 存的已是目标路径，仅当显式指定 publishTarget 时才重写。
 * 无 target 时返回 path 本身——若误调 resolvePublishPath 会把目标解析回源路径，
 * 产生 fromPath === path 的移动，在 Git tree 中同路径写成「先写后删」→ 文件丢失。
 */
export function resolveMoveTarget(path: string, publishTarget?: string | null): string {
  return publishTarget ? resolvePublishPath(path, publishTarget) : path;
}
