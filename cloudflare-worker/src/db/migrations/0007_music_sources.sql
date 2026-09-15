-- ============================================
-- Migration 0007: 音乐域四表收编 (webdav_sources / navidrome_sources / playlist_cache / webhook_events)
-- 此前这四张表由运行时入口兜底建表 (index.ts /admin/api/migrate 端点 与
-- inbound.service.ts claimWebhookEvent), 与 migration 双轨易漂移 (A#7),
-- 现将运行时 DDL 逐字收编为正式 migration, CREATE TABLE IF NOT EXISTS 保证幂等。
-- 入口层兜底保留, 兼容未经 migrations 的旧环境。
-- 执行命令: wrangler d1 migrations apply blog-comments --remote
-- ============================================

-- 1. WebDAV 音源
CREATE TABLE IF NOT EXISTS webdav_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Navidrome 音源
CREATE TABLE IF NOT EXISTS navidrome_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 3. 歌单缓存 (全量重建, 仅保留最新一份)
CREATE TABLE IF NOT EXISTS playlist_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 4. 邮箱回信 webhook 事件去重 (svix-id 幂等, 仅保留 1 天)
CREATE TABLE IF NOT EXISTS webhook_events (svix_id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')));
