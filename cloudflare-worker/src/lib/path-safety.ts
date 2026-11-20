// 路径参数安全校验（零依赖纯函数，可进 node --test）。
//
// 【为什么从 middleware/pathGuard.ts 迁出】services/mediaFileRequest.ts 需要
// isSafePathParam，却因此反向依赖了 middleware —— 违反 AGENTS.md §4 铁律 1，
// 同时让「零依赖可单测」的声明失效（任何 middleware 改动都会波及 services）。
// 校验逻辑本身不依赖 Hono context，属于纯基础设施，落在 lib/ 是正确归属。
//
// middleware/pathGuard.ts 保留 re-export，既有导入点无需改动。
//
// \u4e00-\u9fff 为 CJK 统一表意文字基本区（用转义写法避免字面量在不同编辑器/编码下显示异常）
const PATH_SAFE_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff._\-]+$/;
const PATH_SAFE_PATTERN_WITH_SLASH = /^[a-zA-Z0-9\u4e00-\u9fff._/\-]+$/;

/**
 * 校验路径参数是否安全（拒绝空值、`..` 穿越、NUL 字节与白名单外字符）。
 * @param allowSlash 允许 `/` 分隔（多段 object key / 目录路径用）
 */
export function isSafePathParam(value: string | null | undefined, allowSlash = false): value is string {
  if (!value) return false;
  if (value.includes('..')) return false;
  if (value.includes('\0')) return false;
  return allowSlash ? PATH_SAFE_PATTERN_WITH_SLASH.test(value) : PATH_SAFE_PATTERN.test(value);
}
