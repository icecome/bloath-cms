-- ============================================
-- Migration 0003: 多轮对话 (Resend Inbound 邮箱回信)
-- 执行命令: wrangler d1 migrations apply blog-comments --remote
-- ============================================

-- 1. messages 表新增回信关联 token (通知邮件的 Reply-To 携带 reply+<token>@...)
ALTER TABLE messages ADD COLUMN reply_token TEXT DEFAULT '';

-- 2. 独立 replies 表, 存放多轮对话时间线
CREATE TABLE replies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL,
  reply_content   TEXT NOT NULL,
  reply_type      TEXT NOT NULL DEFAULT '博主'
                  CHECK(reply_type IN ('博主','邮箱回信')),
  reply_from_email TEXT DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
CREATE INDEX idx_replies_message_id ON replies(message_id);