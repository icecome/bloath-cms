// 统一模板标签引擎（借鉴 Sveltia common/template 的精简版）。
//
// 背景：此前媒体命名（rename.ts 的 {Y}{m}{d} 语法）与媒体目录（固定字符串）
// 各自为政，无法表达「按月归档」等需求。本模块提供单一语法：
//
//   {{date:YYYY}} {{date:MM}} {{date:DD}} {{date:HH}} {{date:mm}} {{date:SS}}
//   {{filename}}        （原文件名去扩展名）
//   {{random:N}}        （N 位小写随机串）
//   {{fields.<name>}}   （预留：字段引用，当前媒体场景无上下文时取空）
//
// 兼容：旧模板 {Y}{m}{d}{h}{i}{s}{filename}{str-N} 在 MediaPage 读取配置时
// 由 migrateLegacyTemplate 一次性转换，存储层永远是新语法。
//
// 安全注意：模板只作用于文件名/目录段，输出须经各调用方的 sanitizeSlug /
// 文件名清洗后再落盘，本模块不做路径安全裁剪（职责单一）。

/** 模板支持的标签集合（用于校验与文档提示） */
export const TEMPLATE_TAGS = [
  'date:YYYY', 'date:MM', 'date:DD', 'date:HH', 'date:mm', 'date:SS',
  'filename', 'random:N', 'fields.<name>',
] as const;

const TAG_REGEX = /\{\{([^}]+)\}\}/g;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 旧版 rename.ts 的随机串语义：小写字母+数字 */
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  while (result.length < length) {
    const bytes = new Uint8Array(length - result.length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      const byte = bytes[i];
      if (byte === undefined) break;
      if (byte < 252) {
        result += chars[byte % chars.length] ?? '';
      }
    }
  }
  return result;
}

export interface TemplateContext {
  /** 原文件名（可带扩展名；内部去扩展名） */
  filename?: string;
  /** 字段引用的值表（fields.<name>），媒体命名场景通常不传 */
  fields?: Record<string, unknown>;
  /** 基准时间（默认 now；测试注入用） */
  now?: Date;
}

/**
 * 填充统一模板。未知标签保留原样（便于排查配置错误）。
 */
export function fillTemplate(template: string, context: TemplateContext = {}): string {
  const now = context.now ?? new Date();
  const filename = context.filename
    ? context.filename.replace(/\.[^/.]+$/, '')
    : 'image';

  return template.replace(TAG_REGEX, (match, rawTag: string) => {
    const tag = rawTag.trim();

    if (tag === 'filename') return filename;

    if (tag.startsWith('date:')) {
      const fmt = tag.slice('date:'.length);
      switch (fmt) {
        case 'YYYY': return String(now.getFullYear());
        case 'MM': return pad(now.getMonth() + 1);
        case 'DD': return pad(now.getDate());
        case 'HH': return pad(now.getHours());
        case 'mm': return pad(now.getMinutes());
        case 'SS': return pad(now.getSeconds());
        case 'YYYYMMDD': return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        default: return match;
      }
    }

    const randomMatch = tag.match(/^random:(\d+)$/);
    if (randomMatch) {
      return randomString(parseInt(randomMatch[1] ?? '0', 10));
    }

    if (tag.startsWith('fields.')) {
      const key = tag.slice('fields.'.length);
      const value = context.fields?.[key];
      if (value === undefined || value === null) return '';
      return String(value);
    }

    return match;
  });
}

/**
 * 旧模板 → 新模板迁移。MediaPage/设置页读取 MediaConfig.renameTemplate 时调用；
 * 已是新语法（含 {{）的模板原样返回，幂等。
 *
 * 映射：{Y}→{{date:YYYY}} {m}→{{date:MM}} {d}→{{date:DD}}
 *       {h}→{{date:HH}} {i}→{{date:mm}} {s}→{{date:SS}}
 *       {filename}→{{filename}} {str-N}→{{random:N}}
 */
export function migrateLegacyTemplate(template: string): string {
  if (template.includes('{{')) return template;

  return template.replace(/\{([^{}]+)\}/g, (match, placeholder: string) => {
    switch (placeholder) {
      case 'Y': return '{{date:YYYY}}';
      case 'm': return '{{date:MM}}';
      case 'd': return '{{date:DD}}';
      case 'h': return '{{date:HH}}';
      case 'i': return '{{date:mm}}';
      case 's': return '{{date:SS}}';
      case 'filename': return '{{filename}}';
      default: {
        const strMatch = placeholder.match(/^str-(\d+)$/);
        if (strMatch) {
          return `{{random:${strMatch[1]}}}`;
        }
        // 未知旧占位符原样保留（不吞配置）
        return match;
      }
    }
  });
}

/**
 * 解析目录段模板（mediaPath 场景）：填充后按段清洗。
 * 例如 `assets/{{date:YYYY}}/{{date:MM}}` → `assets/2026/10`。
 * 返回的路径不含首尾斜杠。
 */
export function fillPathTemplate(template: string, context: TemplateContext = {}): string {
  const filled = fillTemplate(template, context);
  return filled
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .join('/');
}
