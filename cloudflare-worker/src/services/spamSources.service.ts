import {
  SPAM_SOURCE_THRESHOLD_IP,
  SPAM_SOURCE_THRESHOLD_EMAIL,
  SPAM_SOURCE_THRESHOLD_NICKNAME,
  SPAM_CONTENT_THRESHOLD,
} from '../comment/config';
import { ApiError } from '../comment/utils/errors';
import { ErrorCode } from '../comment/types';

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
    // 该分支属编程错误（新增维度时漏配阈值），非运行时异常：
    // 用 ApiError 归类为 500 而非让裸 Error 由 errorHandler 回退处理，
    // 日志中能看到明确的配置缺失提示。
    if (!threshold) {
      throw new ApiError(ErrorCode.INTERNAL_ERROR, `未配置垃圾来源阈值：${dimension}`, 500);
    }
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
