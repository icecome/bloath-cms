import {
  SPAM_SOURCE_THRESHOLD_IP,
  SPAM_SOURCE_THRESHOLD_EMAIL,
  SPAM_SOURCE_THRESHOLD_NICKNAME,
  SPAM_CONTENT_THRESHOLD,
} from '../comment/config';

export interface SpamSourceInput {
  name: string;
  email: string;
  ip: string;
  content: string;
}

export async function contentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode((content || '').trim());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const RECORD_SQL =
  `INSERT INTO spam_sources (dimension, value, count) VALUES (?, ?, 1)
   ON CONFLICT(dimension, value) DO UPDATE SET count = count + 1, updated_at = datetime('now')`;

export async function buildRecordSpamSourceStmts(
  db: D1Database,
  source: SpamSourceInput
): Promise<D1PreparedStatement[]> {
  const stmts: D1PreparedStatement[] = [];
  const add = (dimension: string, value: string) => {
    if (!value) return;
    stmts.push(db.prepare(RECORD_SQL).bind(dimension, value));
  };
  add('ip', (source.ip || '').trim());
  add('email', (source.email || '').trim().toLowerCase());
  add('nickname', (source.name || '').trim());
  const hash = source.content ? await contentHash(source.content) : '';
  if (hash) add('content', hash);
  return stmts;
}

const SOURCE_THRESHOLDS: Record<string, number> = {
  ip: SPAM_SOURCE_THRESHOLD_IP,
  email: SPAM_SOURCE_THRESHOLD_EMAIL,
  nickname: SPAM_SOURCE_THRESHOLD_NICKNAME,
  content: SPAM_CONTENT_THRESHOLD,
};

export async function shouldMarkSpam(db: D1Database, source: SpamSourceInput): Promise<boolean> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const add = (dimension: string, value: string) => {
    if (!value) return;
    const threshold = SOURCE_THRESHOLDS[dimension];
    if (!threshold) throw new Error(`未配置垃圾来源阈值: ${dimension}`);
    clauses.push('(dimension=? AND value=? AND count>=?)');
    params.push(dimension, value, threshold);
  };
  add('ip', (source.ip || '').trim());
  add('email', (source.email || '').trim().toLowerCase());
  add('nickname', (source.name || '').trim());
  const hash = source.content ? await contentHash(source.content) : '';
  add('content', hash);
  if (clauses.length === 0) return false;
  const sql = `SELECT 1 FROM spam_sources WHERE ${clauses.join(' OR ')} LIMIT 1`;
  const row = await db.prepare(sql).bind(...params).first();
  return !!row;
}
