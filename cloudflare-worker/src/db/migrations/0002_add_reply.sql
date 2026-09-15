-- ============================================
-- Migration 0002: 留言回复功能
-- 执行命令: wrangler d1 migrations apply blog-comments --remote
-- ============================================

-- 1. messages 表新增回复字段
ALTER TABLE messages ADD COLUMN reply_content TEXT DEFAULT '';
ALTER TABLE messages ADD COLUMN reply_at DATETIME DEFAULT NULL;

-- 2. 重建 admin_logs 表以放宽 action CHECK 约束 (支持 reply/delete_reply)
CREATE TABLE admin_logs_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL,
  action          TEXT NOT NULL
                  CHECK(action IN ('approve','feature','spam','delete','restore','reply','delete_reply')),
  operator        TEXT DEFAULT 'system',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

INSERT INTO admin_logs_new SELECT id, message_id, action, operator, created_at FROM admin_logs;
DROP TABLE admin_logs;
ALTER TABLE admin_logs_new RENAME TO admin_logs;
CREATE INDEX idx_admin_logs_message_id ON admin_logs(message_id);
