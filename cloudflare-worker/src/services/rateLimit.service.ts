interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  db: D1Database,
  identifier: string,
  actionType: string,
  maxCount: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO rate_limits (identifier, action_type, count, window_start)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(identifier, action_type, window_start) DO UPDATE SET count = count + 1
       RETURNING count`
    )
    .bind(identifier, actionType, windowStart)
    .all<{ count: number }>();
  const currentCount = result.results?.[0]?.count ?? 1;
  const staleBefore = new Date(Date.now() - windowMs).toISOString();
  try {
    await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(staleBefore).run();
  } catch { /* 清理失败不阻塞限流 */ }
  if (currentCount > maxCount) {
    return { allowed: false, currentCount, retryAfterSeconds: windowSeconds };
  }
  return { allowed: true, currentCount, retryAfterSeconds: 0 };
}
