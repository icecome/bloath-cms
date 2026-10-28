/**
 * 时间戳解析（零依赖，供 sortFiles / extractFrontMatter 共用）。
 *
 * 为什么要单独成文件：列表排序需要被单测覆盖，而 sortFiles.ts 原先把解析函数
 * 摆在 extractFrontMatter.ts 里，该模块依赖 api/frontmatter/concurrency，
 * node ESM 下无法直接 import（缺 .ts 后缀的裸相对导入），导致排序逻辑长期没有测试。
 * 拆出零依赖模块后，sortFiles.test.ts 可以直接加载本文件。
 */

/** 20260707 / 20260707123045 */
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/;
/** 2026-07-07 / 2026_07_07 / 2026-07-07T12:00:00 / 2026-07-07 12:00:00 */
const SEPARATED_DATE = /^(\d{4})[-_](\d{1,2})[-_](\d{1,2})(?:[-_T ](\d{1,2})[-_:](\d{1,2})[-_:](\d{1,2}))?/;
/** 2026年7月7日 / 2026/7/7 等宽松写法 */
const LOOSE_DATE = /(\d{4})[-/年](\d{1,2})[-/月]?(\d{1,2})?[\s日]?/;

function buildLocalTimestamp(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number {
  if (!Number.isFinite(year) || year < 1970 || year > 9999) return 0;
  if (!Number.isFinite(month) || month < 1 || month > 12) return 0;
  if (!Number.isFinite(day) || day < 1 || day > 31) return 0;
  if (hour > 23 || minute > 59 || second > 59) return 0;
  const ts = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * 纯数字时间戳归一化：13 位毫秒 / 10 位秒 / 8 位 YYYYMMDD。
 *
 * 旧实现 `if (typeof dateValue === 'number') return dateValue;` 把 YAML 解析出的
 * `date: 20260707` 当成 1970-01-01 的毫秒值，排序键直接掉到最底；
 * `date: 1767225600`（秒级 epoch）同样被当成毫秒。
 */
function parseNumericTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1e11) return Math.floor(value);          // 13 位毫秒
  if (value >= 1e9) return Math.floor(value) * 1000;    // 10 位秒
  if (value >= 19000101 && value <= 99991231) {         // 8 位 YYYYMMDD
    const year = Math.floor(value / 10000);
    const month = Math.floor((value % 10000) / 100);
    const day = value % 100;
    return buildLocalTimestamp(year, month, day);
  }
  return 0;
}

/**
 * 将 front-matter 的时间字段转换为时间戳（解析失败返回 0）。
 * 支持：Date 对象、ISO 8601、纯日期、中文日期、紧凑日期、秒/毫秒时间戳。
 */
export function parseDateToTimestamp(dateValue?: string | number | Date): number {
  if (dateValue === undefined || dateValue === null || dateValue === '') return 0;

  if (dateValue instanceof Date) {
    const ts = dateValue.getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }

  if (typeof dateValue === 'number') return parseNumericTimestamp(dateValue);

  if (typeof dateValue !== 'string') return 0;

  const raw = dateValue.trim();
  if (!raw) return 0;

  // 纯数字字符串必须先走数字分支：new Date('1767225600') 在 V8 下是 Invalid Date
  if (/^\d{8}$|^\d{10}$|^\d{13}$/.test(raw)) {
    const fromNumber = parseNumericTimestamp(Number(raw));
    if (fromNumber > 0) return fromNumber;
  }

  // 自建解析优先于 new Date()：后者对 '2026/07/07' 给本地零点、对 '2026-07-07' 给 UTC 零点，
  // 同一批文章会出现 8 小时口径漂移。先自建，保证同源格式口径一致。
  const compact = raw.match(COMPACT_DATE);
  if (compact) {
    return buildLocalTimestamp(
      Number(compact[1]), Number(compact[2]), Number(compact[3]),
      compact[4] ? Number(compact[4]) : 0,
      compact[5] ? Number(compact[5]) : 0,
      compact[6] ? Number(compact[6]) : 0
    );
  }

  const separated = raw.match(SEPARATED_DATE);
  if (separated) {
    return buildLocalTimestamp(
      Number(separated[1]), Number(separated[2]), Number(separated[3]),
      separated[4] ? Number(separated[4]) : 0,
      separated[5] ? Number(separated[5]) : 0,
      separated[6] ? Number(separated[6]) : 0
    );
  }

  // 带时区偏移的 ISO / RFC 2822 交给 Date 处理
  const iso = new Date(raw).getTime();
  if (!Number.isNaN(iso) && iso > 0) return iso;

  const loose = raw.match(LOOSE_DATE);
  if (loose) {
    return buildLocalTimestamp(
      Number(loose[1]),
      Number(loose[2]),
      loose[3] ? Number(loose[3]) : 1
    );
  }

  return 0;
}
