// 路径参数与安全 JSON 解析（独立于会话/CORS）
//
// isSafePathParam 的实现在 lib/path-safety.ts（零依赖，可被 services 直接引用）。
// 此处 re-export 保持既有导入点兼容：routes/* 仍从本模块取，未迁移的调用点不必改动。
//
// 值导入必须带 .ts 后缀：本文件被 node --experimental-strip-types 测试链路加载
// （services/mediaLimits.contract.test.ts 直接 import 本模块读常量），
// 缺后缀会在 node ESM 下抛 ERR_MODULE_NOT_FOUND（AGENTS.md §9 已知坑）。
export { isSafePathParam } from '../lib/path-safety.ts';
import { isSafePathParam } from '../lib/path-safety.ts';

/**
 * 单文件内容上限：**base64 字符串长度**（不是二进制体积）。
 * 20 MB base64 ≈ 15 MB 二进制，对应前端 IMAGE_ORIGINAL_MAX_BYTES
 * （见 web/src/lib/mediaLimits.ts）。调整时两侧需同步：前端用 estimateBase64Length
 * 提前拦截，否则会出现「前端放行、服务端 400」。
 */
export const MAX_CONTENT_SIZE = 20 * 1024 * 1024;

/** JSON 请求体上限：媒体 base64 塞在 JSON 里时需比 MAX_CONTENT_SIZE 更宽（含其它字段与转义） */
export const MAX_JSON_BODY_SIZE = 40 * 1024 * 1024;

/** 媒体二进制端点（PUT /api/repos/media）的原始字节上限 */
export const MAX_MEDIA_BINARY_SIZE = 25 * 1024 * 1024;

/**
 * 解析并净化 JSON 请求体。
 * @param maxBytes 文本长度上限；默认沿用 20 MB，媒体相关调用点传 MAX_JSON_BODY_SIZE
 */
export function safeJsonParse(text: string, maxBytes = 20 * 1024 * 1024): Record<string, unknown> {
  if (text.length > maxBytes) throw new Error('JSON payload too large');
  const obj = JSON.parse(text) as Record<string, unknown>;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid JSON payload');
  const safeObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') safeObj[key] = value;
  }
  return safeObj;
}
