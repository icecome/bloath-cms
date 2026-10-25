// app_settings 共享表的通用读写。
// 历史：本文件曾承载 BlogPushSetting（留言模块推送配置），该模块下线后
// 对应读写函数一并删除（audit m-04：全仓 grep 无调用点的死代码）。
// 现存消费者：bufferConfig / mediaS3Config 两个配置服务。

export async function getSettingRaw(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function saveSettingRaw(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(key, value)
    .run();
}
