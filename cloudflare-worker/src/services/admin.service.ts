import type { MessageRow } from '../comment/types';
import { VALID_STATUSES } from '../comment/config';
import { ACTION_STATUS_MAP } from './message.service';
import { buildRecordSpamSourceStmts } from './spamSources.service';

export interface AdminListParams {
  status?: string;
  size: number;
  cursor?: number;
}

export async function listAdminMessages(
  db: D1Database, params: AdminListParams
): Promise<{ items: MessageRow[]; hasMore: boolean; total: number }> {
  let sql = 'SELECT * FROM messages WHERE is_deleted = 0';
  const bindings: unknown[] = [];
  if (params.status && VALID_STATUSES.includes(params.status as typeof VALID_STATUSES[number])) {
    sql += ' AND status = ?';
    bindings.push(params.status);
  }
  if (params.cursor) { sql += ' AND id < ?'; bindings.push(params.cursor); }
  sql += ' ORDER BY id DESC LIMIT ?';
  bindings.push(params.size + 1);
  const { results } = await db.prepare(sql).bind(...bindings).all<MessageRow>();
  const items = results;
  let countSql = 'SELECT COUNT(*) as total FROM messages WHERE is_deleted = 0';
  const countBindings: unknown[] = [];
  if (params.status && VALID_STATUSES.includes(params.status as typeof VALID_STATUSES[number])) {
    countSql += ' AND status = ?';
    countBindings.push(params.status);
  }
  const countResult = await db.prepare(countSql).bind(...countBindings).first<{ total: number }>();
  const hasMore = items.length > params.size;
  if (hasMore) items.pop();
  return { items, hasMore, total: countResult?.total ?? 0 };
}

export async function batchOperateMessages(
  db: D1Database, ids: number[], action: string
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
  const spamSourceStmts: D1PreparedStatement[] = [];
  if (action === 'spam') {
    for (const r of existingRows) {
      spamSourceStmts.push(...await buildRecordSpamSourceStmts(db, { name: r.visitor_name || '', email: r.visitor_email || '', ip: r.visitor_ip || '', content: r.content || '' }));
    }
  }
  await db.batch([...updateStmts, ...spamSourceStmts]);
  return { missingIds: [] };
}

export async function writeBatchAuditLogs(db: D1Database, ids: number[], action: string): Promise<void> {
  await db.batch(ids.map((id) => db.prepare("INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, 'admin')").bind(id, action)));
}
