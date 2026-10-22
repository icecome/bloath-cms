// 字段级校验纯逻辑（P2-4）：pattern / min / max。
// 独立成模块的原因：SchemaFormPanel 是 .tsx（含 JSX），node --experimental-strip-types
// 测试环境无法加载；此处零 React 依赖，可被单测直接锁定（validate.test.ts）。
import type { FieldConfig } from '../../../shared/types';

/** 可应用 pattern 校验的文本类字段 */
const PATTERN_TYPES = new Set(['string', 'text', 'url', 'slug']);

/** 文本类字段（maxLength 生效范围） */
export const LENGTH_TYPES = new Set(['string', 'text', 'url', 'slug']);

/**
 * 校验单个字段值。返回用户可读错误消息；通过返回 null。
 * 口径：
 * - 空值跳过（required 语义独立于本函数）；
 * - pattern：完整匹配（^(?:pattern)$），避免「部分匹配即通过」的歧义；
 *   配置的正则非法时跳过校验（不因配置错误阻断保存），控制台提示；
 * - min/max：仅 number 类型，含边界。
 */
export function validateFieldValue(field: FieldConfig, value: unknown): string | null {
  const empty = value === undefined || value === null || value === '';

  if (!empty && field.pattern && PATTERN_TYPES.has(field.type) && typeof value === 'string') {
    try {
      if (!new RegExp(`^(?:${field.pattern})$`).test(value)) {
        return field.patternMessage || `${field.label}格式不正确`;
      }
    } catch {
      console.warn(`[SchemaForm] 字段 ${field.name} 的 pattern 非法：`, field.pattern);
    }
  }

  if (!empty && field.type === 'number' && typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      return `${field.label}不能小于 ${field.min}`;
    }
    if (field.max !== undefined && value > field.max) {
      return `${field.label}不能大于 ${field.max}`;
    }
  }

  return null;
}

/** 文本输入 onChange 的长度裁剪：超长截断，避免「能输不能存」的错位体验 */
export function clampText(value: string, field: FieldConfig): string {
  if (field.maxLength !== undefined && LENGTH_TYPES.has(field.type) && value.length > field.maxLength) {
    return value.slice(0, field.maxLength);
  }
  return value;
}

/**
 * 保存前对整个 front-matter 做字段级校验，返回首个错误消息（无错误返回 null）。
 * 供 EditorPage.handleSave 在提交前调用；visible 谓词由调用方注入
 * （showWhen 判定留在组件层，避免本模块依赖 Frontmatter 结构）。
 */
export function validateFrontmatterFields(
  entries: Array<{ field: FieldConfig; value: unknown }>
): string | null {
  for (const { field, value } of entries) {
    const error = validateFieldValue(field, value);
    if (error) return error;
  }
  return null;
}
