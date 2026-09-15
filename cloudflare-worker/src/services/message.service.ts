import type { Env } from '../env';
import type { CreateMessageInput, MessageRow, ReplyRow, MessageWithReplies, ListParams, PaginatedResult } from '../comment/types';
import { ErrorCode } from '../comment/types';
import { ApiError } from '../comment/utils/errors';
import { validateCreateMessage } from '../comment/utils/validators';
import { verifyToken } from './turnstile.service';
import { checkRateLimit } from './rateLimit.service';
import { shouldMarkSpam, buildRecordSpamSourceStmts } from './spamSources.service';
import { sendNotificationEmail, sendReplyEmail } from './email.service';
import { sendPushNotification, sendInboundReplyAlert } from './vectrel.service';
import { getBlogPushSetting } from './settings.service';
import {
  IP_LIMIT_COUNT, IP_LIMIT_WINDOW, EMAIL_LIMIT_COUNT, EMAIL_LIMIT_WINDOW,
  GLOBAL_LIMIT_COUNT, GLOBAL_LIMIT_WINDOW, RATE_LIMIT_ACTION, VALID_ACTIONS,
} from '../comment/config';

export async function createMessage(
  env: Env, input: unknown, ip: string, ua: string
): Promise<{ id: number; notifications?: Promise<void[]> }> {
  const data = validateCreateMessage(input) as CreateMessageInput;
  if (data.cf_verified) {
    if (!data.turnstile_token || data.turnstile_token.trim() === '') {
      throw new ApiError(ErrorCode.TURNSTILE_FAILED, '人机验证Token不能为空', 400);
    }
    const isValid = await verifyToken(data.turnstile_token, ip, env.TURNSTILE_SECRET_KEY);
    if (!isValid) throw new ApiError(ErrorCode.TURNSTILE_FAILED, '人机验证未通过', 400);
  }
  const ipResult = await checkRateLimit(env.DB, ip, RATE_LIMIT_ACTION, IP_LIMIT_COUNT, IP_LIMIT_WINDOW);
  if (!ipResult.allowed) throw new ApiError(ErrorCode.RATE_LIMITED, `提交过于频繁，请${IP_LIMIT_WINDOW}秒后再试`, 429);
  if (data.visitor_email) {
    const emailResult = await checkRateLimit(env.DB, data.visitor_email, RATE_LIMIT_ACTION, EMAIL_LIMIT_COUNT, EMAIL_LIMIT_WINDOW);
    if (!emailResult.allowed) throw new ApiError(ErrorCode.RATE_LIMITED, `该邮箱提交过于频繁，请${EMAIL_LIMIT_WINDOW}秒后再试`, 429);
  }
  const globalResult = await checkRateLimit(env.DB, 'global', RATE_LIMIT_ACTION, GLOBAL_LIMIT_COUNT, GLOBAL_LIMIT_WINDOW);
  if (!globalResult.allowed) throw new ApiError(ErrorCode.RATE_LIMITED, '系统繁忙，请稍后重试', 429);
  const spamHit = await shouldMarkSpam(env.DB, { name: data.visitor_name, email: data.visitor_email || '', ip, content: data.content });
  const needsReview = data.cf_verified ? 0 : 1;
  const status = spamHit ? 'spam' : 'pending';
  const result = await env.DB
    .prepare(`INSERT INTO messages (visitor_name, visitor_email, visitor_website, visitor_ip, user_agent, client_hash, content, quoted_text, page_url, page_title, status, needs_review) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`)
    .bind(data.visitor_name, data.visitor_email || '', data.visitor_website || '', ip, ua, data.content, data.quoted_text || '', data.page_url, data.page_title, status, needsReview)
    .run();
  const insertId = result.meta.last_row_id;
  const msgRow = await getMessageById(env.DB, insertId);
  let notifications: Promise<void[]> | undefined;
  if (msgRow) {
    notifications = Promise.allSettled([
      getBlogPushSetting(env.DB)
        .then((s) => (s.emailEnabled ? sendNotificationEmail(env, msgRow) : undefined))
        .catch((err) => console.error('[createMessage] 邮件提醒开关读取失败:', err)),
      sendPushNotification(env, msgRow),
    ]).then((results): void[] => {
      results.forEach((r) => { if (r.status === 'rejected') console.error('[createMessage] 通知发送失败:', r.reason); });
      return [];
    });
  }
  return { id: insertId, notifications };
}

const PUBLIC_LIST_FIELDS = 'id, visitor_name, visitor_website, content, quoted_text, page_url, page_title, status, needs_review, reply_content, reply_at, created_at, updated_at';

export async function listMessages(db: Env['DB'], params: ListParams): Promise<PaginatedResult<MessageWithReplies>> {
  const size = Math.min(50, Math.max(1, params.size || 10));
  const cursor = params.cursor ?? 0;
  let whereSql = 'WHERE is_deleted = 0';
  const bindParams: unknown[] = [];
  const hasStatusFilter = params.status === 'approved' || params.status === 'featured';
  if (hasStatusFilter) { whereSql += ' AND status = ?'; bindParams.push(params.status); }
  else { whereSql += " AND status IN (?, ?)"; bindParams.push('approved', 'featured'); }
  if (params.page_url) { whereSql += ' AND page_url = ?'; bindParams.push(params.page_url); }
  if (cursor > 0) {
    whereSql += ' AND (created_at < (SELECT created_at FROM messages WHERE id = ?) OR (created_at = (SELECT created_at FROM messages WHERE id = ?) AND id < ?))';
    bindParams.push(cursor, cursor, cursor);
  }
  const querySize = size + 1;
  const itemsResult = await db
    .prepare(`SELECT ${PUBLIC_LIST_FIELDS} FROM messages ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...bindParams, querySize)
    .all<MessageRow>();
  const allItems = itemsResult.results || [];
  const hasMore = allItems.length > querySize - 1;
  const items = hasMore ? allItems.slice(0, size) : allItems;
  const itemsWithReplies = await attachReplies(db, items);
  const nextCursor = hasMore && itemsWithReplies.length > 0 ? itemsWithReplies[itemsWithReplies.length - 1].id : null;
  const countResult = hasStatusFilter && params.page_url
    ? await db.prepare(`SELECT COUNT(*) as total FROM messages WHERE is_deleted = 0 AND status = ? AND page_url = ?`).bind(params.status, params.page_url).first<{ total: number }>()
    : hasStatusFilter
      ? await db.prepare(`SELECT COUNT(*) as total FROM messages WHERE is_deleted = 0 AND status = ?`).bind(params.status).first<{ total: number }>()
      : params.page_url
        ? await db.prepare(`SELECT COUNT(*) as total FROM messages WHERE is_deleted = 0 AND status IN ('approved', 'featured') AND page_url = ?`).bind(params.page_url).first<{ total: number }>()
        : await db.prepare(`SELECT COUNT(*) as total FROM messages WHERE is_deleted = 0 AND status IN ('approved', 'featured')`).first<{ total: number }>();
  return { items: itemsWithReplies, has_more: hasMore, next_cursor: nextCursor, total: countResult?.total ?? 0 };
}

export async function attachReplies(db: D1Database, items: MessageRow[], includeEmail = false): Promise<MessageWithReplies[]> {
  if (items.length === 0) return [];
  const ids = items.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const repliesResult = await db
    .prepare(`SELECT id, message_id, reply_content, reply_type, reply_from_email, created_at FROM replies WHERE message_id IN (${placeholders}) ORDER BY id ASC`)
    .bind(...ids)
    .all<ReplyRow>();
  const byMessage = new Map<number, ReplyRow[]>();
  for (const r of repliesResult.results || []) {
    const list = byMessage.get(r.message_id) || [];
    list.push(includeEmail ? r : { ...r, reply_from_email: '' });
    byMessage.set(r.message_id, list);
  }
  return items.map((m) => ({ ...m, replies: byMessage.get(m.id) || [] }));
}

export function generateReplyToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getMessageById(db: D1Database, id: number): Promise<MessageRow | null> {
  return db.prepare('SELECT * FROM messages WHERE id = ? AND is_deleted = 0').bind(id).first<MessageRow>();
}

export async function getPublicMessageById(db: D1Database, id: number): Promise<MessageRow | null> {
  return db.prepare(`SELECT ${PUBLIC_LIST_FIELDS} FROM messages WHERE id = ? AND is_deleted = 0 AND status IN ('approved', 'featured')`).bind(id).first<MessageRow>();
}

export const ACTION_STATUS_MAP: Record<string, string> = {
  approve: 'approved', feature: 'featured', spam: 'spam', restore: 'pending',
};

export async function updateMessageStatus(db: D1Database, id: number, action: string, operator: string): Promise<void> {
  if (!VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    throw new ApiError(ErrorCode.INVALID_STATUS_TRANSITION, `无效的操作: ${action}`, 400);
  }
  const existing = await getMessageById(db, id);
  if (!existing) throw new ApiError(ErrorCode.MESSAGE_NOT_FOUND, '留言不存在', 404);
  const targetStatus = ACTION_STATUS_MAP[action];
  const validTransitions: Record<string, string[]> = {
    pending: ['approved', 'featured', 'spam'],
    approved: ['featured', 'spam', 'pending'],
    featured: ['spam', 'approved', 'pending'],
    spam: ['pending'],
  };
  const allowedFrom = validTransitions[targetStatus] || [];
  if (!allowedFrom.includes(existing.status)) {
    if (action !== 'feature' || existing.status !== 'pending') {
      throw new ApiError(ErrorCode.INVALID_STATUS_TRANSITION, `无法从 "${existing.status}" 转换为 "${targetStatus}"`, 400);
    }
  }
  if (targetStatus === 'spam') {
    const recordStmts = await buildRecordSpamSourceStmts(db, { name: existing.visitor_name, email: existing.visitor_email || '', ip: existing.visitor_ip || '', content: existing.content || '' });
    await db.batch([
      db.prepare('UPDATE messages SET status = ?, updated_at = datetime("now") WHERE id = ?').bind(targetStatus, id),
      db.prepare('INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, ?)').bind(id, action, operator || 'admin'),
      ...recordStmts,
    ]);
    return;
  }
  await db.batch([
    db.prepare('UPDATE messages SET status = ?, updated_at = datetime("now") WHERE id = ?').bind(targetStatus, id),
    db.prepare('INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, ?)').bind(id, action, operator || 'admin'),
  ]);
}

export async function softDeleteMessage(db: D1Database, id: number, operator: string): Promise<void> {
  const existing = await getMessageById(db, id);
  if (!existing) throw new ApiError(ErrorCode.MESSAGE_NOT_FOUND, '留言不存在', 404);
  await db.batch([
    db.prepare("UPDATE messages SET is_deleted = 1, reply_token = '', updated_at = datetime('now') WHERE id = ?").bind(id),
    db.prepare('INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, ?)').bind(id, 'delete', operator || 'admin'),
  ]);
}

const REPLY_MAX_LENGTH = 2000;

export async function upsertMessageReply(
  env: Env, id: number, content: string, operator: string, isUpdate = false
): Promise<{ notify: Promise<void> | null }> {
  const trimmed = (content || '').trim();
  if (!trimmed) throw new ApiError(ErrorCode.VALIDATION_ERROR, '回复内容不能为空', 400);
  if (trimmed.length > REPLY_MAX_LENGTH) throw new ApiError(ErrorCode.VALIDATION_ERROR, `回复内容不能超过 ${REPLY_MAX_LENGTH} 字`, 400);
  const existing = await getMessageById(env.DB, id);
  if (!existing) throw new ApiError(ErrorCode.MESSAGE_NOT_FOUND, '留言不存在', 404);
  const token = existing.reply_token || generateReplyToken();
  const latestReply = isUpdate
    ? await env.DB.prepare("SELECT id FROM replies WHERE message_id = ? AND reply_type = '博主' ORDER BY id DESC LIMIT 1").bind(id).first<{ id: number }>()
    : null;
  await env.DB.batch([
    env.DB.prepare("UPDATE messages SET reply_content = ?, reply_at = datetime('now'), reply_token = ?, updated_at = datetime('now') WHERE id = ?").bind(trimmed, token, id),
    latestReply
      ? env.DB.prepare('UPDATE replies SET reply_content = ? WHERE id = ?').bind(trimmed, latestReply.id)
      : env.DB.prepare("INSERT INTO replies (message_id, reply_content, reply_type, reply_from_email) VALUES (?, ?, '博主', '')").bind(id, trimmed),
    env.DB.prepare('INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, ?)').bind(id, 'reply', operator || 'admin'),
  ]);
  let notify: Promise<void> | null = null;
  if (existing.visitor_email) {
    notify = sendReplyEmail(env, { ...existing, reply_content: trimmed, reply_token: token }).catch((err) => {
      console.error('[upsertMessageReply] 回复邮件发送失败:', err);
    });
  }
  return { notify };
}

export async function deleteMessageReply(db: Env['DB'], messageId: number, replyId: number): Promise<void> {
  const existing = await getMessageById(db, messageId);
  if (!existing) throw new ApiError(ErrorCode.MESSAGE_NOT_FOUND, '留言不存在', 404);
  const reply = await db.prepare("SELECT id, reply_type FROM replies WHERE id = ? AND message_id = ? AND reply_type = '博主'").bind(replyId, messageId).first<{ id: number; reply_type: string }>();
  if (!reply) throw new ApiError(ErrorCode.VALIDATION_ERROR, '指定回复不存在', 400);
  const latestReply = await db.prepare("SELECT reply_content, created_at FROM replies WHERE message_id = ? AND reply_type = '博主' AND id != ? ORDER BY id DESC LIMIT 1").bind(messageId, replyId).first<{ reply_content: string; created_at: string }>();
  await db.batch([
    db.prepare("DELETE FROM replies WHERE id = ? AND message_id = ? AND reply_type = '博主'").bind(replyId, messageId),
    db.prepare('UPDATE messages SET reply_content = ?, reply_at = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(latestReply?.reply_content || '', latestReply?.created_at || null, messageId),
    db.prepare('INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, ?)').bind(messageId, 'delete_reply', 'admin'),
  ]);
}

export async function findByReplyToken(db: D1Database, token: string): Promise<MessageRow | null> {
  if (!token) return null;
  return db.prepare('SELECT * FROM messages WHERE reply_token = ? AND is_deleted = 0').bind(token).first<MessageRow>();
}

export async function appendEmailReply(
  env: Env, messageId: number, content: string, fromEmail: string
): Promise<{ alert: Promise<void> | null }> {
  const trimmed = (content || '').trim();
  if (!trimmed) return { alert: null };
  const safeContent = trimmed.slice(0, REPLY_MAX_LENGTH);
  const sender = (fromEmail || '').slice(0, 200);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO replies (message_id, reply_content, reply_type, reply_from_email) VALUES (?, ?, '邮箱回信', ?)").bind(messageId, safeContent, sender),
    env.DB.prepare("UPDATE messages SET updated_at = datetime('now') WHERE id = ?").bind(messageId),
    env.DB.prepare('INSERT INTO admin_logs (message_id, action, operator) VALUES (?, ?, ?)').bind(messageId, 'reply', 'email-inbound'),
  ]);
  const alert = sendInboundReplyAlert(env, trimmed, sender).catch((err) => {
    console.error('[appendEmailReply] 回信提醒发送失败:', err);
  });
  return { alert };
}
