import type { MessageRow } from '../comment/types';
import { VALID_STATUSES } from '../comment/config';
import { ACTION_STATUS_MAP } from './message.service';
import { buildRecordSpamSourceStmts } from './spamSources.service';

export interface AdminListParams {
  status?: string;
  size: number;
  cursor?: number;
}

/**
 * 构造留言列表的 WHERE 片段。
 * 列表查询与计数查询共用同一份条件，避免两处重复拼装后条件漂移。
 */
function buildMessageFilter(params: { status?: string; cursor?: number }): { where: string; bindings: unknown[] } {
  let where = ' WHERE is_deleted = 0';
  const bindings: unknown[] = [];

  if (params.status && VALID_STATUSES.includes(params.status as typeof VALID_STATUSES[number])) {
    where += ' AND status = ?';
    bindings.push(params.status);
  }
  if (params.cursor) {
    // 与公开列表（message.service.listMessages）保持同一游标语义：
    // created_at 精度为秒，同秒内可并存多条，仅靠 id 会在同秒边界漏/重记录。
    where += ' AND (created_at < (SELECT created_at FROM messages WHERE id = ?)'
      + ' OR (created_at = (SELECT created_at FROM messages WHERE id = ?) AND id < ?))';
    bindings.push(params.cursor, params.cursor, params.cursor);
  }
  return { where, bindings };
}

export async function listAdminMessages(
  db: D1Database, params: AdminListParams
): Promise<{ items: MessageRow[]; hasMore: boolean; total: number }> {
  const { where, bindings } = buildMessageFilter(params);
  const { results } = await db
    .prepare(`SELECT * FROM messages${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...bindings, params.size + 1)
    .all<MessageRow>();
  const items = results;

  // 计数不复用游标条件：total 表示筛选后的总量，与翻页位置无关
  const countFilter = buildMessageFilter({ status: params.status });
  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM messages${countFilter.where}`)
    .bind(...countFilter.bindings)
    .first<{ total: number }>();

  const hasMore = items.length > params.size;
  if (hasMore) items.pop();
  return { items, hasMore, total: countResult?.total ?? 0 };
}

export async function batchOperateMessages(
  db: D1Database, ids: number[], action: string, operator = 'admin'
): Promise<{ missingIds: number[] }> {
  const placeholders = ids.map(() => '?').join(',');
  const checkResult = await db.prepare(
    `SELECT id, visitor_name, visitor_email, visitor_ip, content FROM messages WHERE id IN (${placeholders}) AND is_deleted = 0`
  ).bind(...ids).all<{ id: number; visitor_name: string; visitor_email: string; visitor_ip: string; content: string }>();
  const existingRows = checkResult.results;
  const existingIds = new Set(existingRows.map((r) => r.id));
  const missingIds = ids.filter((id) => !existingIds.has(id));
  if (missingIds.length > 0) return { missingIds };
  const updateStmts: D1PreparedStatement[] = ids.map((id) =>
    action === 'delete'
      ? db.prepare("UPDATE messages SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?").bind(id)
      : db.prepare("UPDATE messages SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(ACTION_STATUS_MAP[action], id)
  );
  // 审计日志与状态变更同批提交：分两次 db.batch 时日志失败会留下无记录的状态变更，
  // 与单条路径（message.service.updateMessageStatus）的原子语义保持一致。
  const auditStmts: D1PreparedStatement[] = ids.map((id) =>
    db.prepare('INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, ?)').bind(id, action, operator)
  );
  const spamSourceStmts: D1PreparedStatement[] = [];
  if (action === 'spam') {
    for (const r of existingRows) {
      spamSourceStmts.push(...await buildRecordSpamSourceStmts(db, { name: r.visitor_name || '', email: r.visitor_email || '', ip: r.visitor_ip || '', content: r.content || '' }));
    }
  }
  await db.batch([...updateStmts, ...auditStmts, ...spamSourceStmts]);
  return { missingIds: [] };
}
