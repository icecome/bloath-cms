// 路径参数与安全 JSON 解析（独立于会话/CORS）
// \u4e00-\u9fff 为 CJK 统一表意文字基本区（用转义写法避免字面量在不同编辑器/编码下显示异常）
const PATH_SAFE_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff._\-]+$/;
const PATH_SAFE_PATTERN_WITH_SLASH = /^[a-zA-Z0-9\u4e00-\u9fff._/\-]+$/;

export const MAX_CONTENT_SIZE = 10 * 1024 * 1024;

export function isSafePathParam(value: string | null | undefined, allowSlash = false): value is string {
  if (!value) return false;
  if (value.includes('..')) return false;
  if (value.includes('\0')) return false;
  return allowSlash ? PATH_SAFE_PATTERN_WITH_SLASH.test(value) : PATH_SAFE_PATTERN.test(value);
}

export function safeJsonParse(text: string): Record<string, unknown> {
  if (text.length > 20 * 1024 * 1024) throw new Error('JSON payload too large');
  const obj = JSON.parse(text) as Record<string, unknown>;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid JSON payload');
  const safeObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') safeObj[key] = value;
  }
  return safeObj;
}
