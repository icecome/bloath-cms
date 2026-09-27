/**
 * HTML 实体转义。
 *
 * 注意：这是实体转义而非 HTML 白名单清洗，不能替代 sanitize 用途。
 * 命名保持 escapeHtml 以反映其真实行为。
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
