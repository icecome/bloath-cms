export interface BlogPushSetting {
  enabled: boolean;
  channelIds: number[];
  emailEnabled: boolean;
}

const BLOG_PUSH_KEY = 'blog_push';
const DEFAULT_SETTING: BlogPushSetting = { enabled: true, channelIds: [], emailEnabled: false };

export async function getBlogPushSetting(db: D1Database): Promise<BlogPushSetting> {
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(BLOG_PUSH_KEY)
      .first<{ value: string }>();
    if (!row) return { ...DEFAULT_SETTING };
    const parsed = JSON.parse(row.value) as Partial<BlogPushSetting>;
    return {
      enabled: parsed.enabled !== false,
      channelIds: Array.isArray(parsed.channelIds)
        ? parsed.channelIds.filter((n): n is number => Number.isInteger(n) && n > 0)
        : [],
      emailEnabled: parsed.emailEnabled === true,
    };
  } catch {
    return { ...DEFAULT_SETTING };
  }
}

export async function saveBlogPushSetting(db: D1Database, setting: BlogPushSetting): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(BLOG_PUSH_KEY, JSON.stringify(setting))
    .run();
}
