-- ============================================
-- Migration 0001: 博客留言系统初始表结构
-- 执行命令: wrangler d1 migrations apply blog-comments --remote
-- ============================================

-- 1. 留言主表
CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 访客信息
  visitor_name    TEXT NOT NULL,
  visitor_email   TEXT DEFAULT '',
  visitor_ip      TEXT NOT NULL,
  user_agent      TEXT DEFAULT '',
  client_hash     TEXT DEFAULT '',          -- 客户端指纹 (SHA256)

  -- 内容信息
  content         TEXT NOT NULL,
  quoted_text     TEXT DEFAULT '',          -- 引用段落 (Phase 4 实现)

  -- 上下文信息
  page_url        TEXT NOT NULL,
  page_title      TEXT NOT NULL,

  -- 状态管理
  status          TEXT DEFAULT 'pending'     -- pending/approved/featured/spam
                                      CHECK(status IN ('pending','approved','featured','spam')),
  is_deleted      INTEGER DEFAULT 0         -- 0=正常, 1=软删除
                                      CHECK(is_deleted IN (0, 1)),
  needs_review    INTEGER DEFAULT 0         -- Turnstile降级标记, 0=正常, 1=需重点审核
                                      CHECK(needs_review IN (0, 1)),

  -- 时间戳
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 索引
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_page_url ON messages(page_url);
CREATE INDEX idx_messages_page_status_created
  ON messages(page_url, status, created_at DESC);

-- 3. 反垃圾频率限制表
CREATE TABLE rate_limits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier      TEXT NOT NULL,            -- IP 或邮箱
  action_type     TEXT NOT NULL,            -- 'submit_message'
  count           INTEGER DEFAULT 1,
  window_start    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_rate_limits_unique
  ON rate_limits(identifier, action_type, window_start);

-- 4. 管理员操作日志表
CREATE TABLE admin_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL,
  action          TEXT NOT NULL            -- approve/feature/spam/delete/restore
                                      CHECK(action IN ('approve','feature','spam','delete','restore')),
  operator        TEXT DEFAULT 'system',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX idx_admin_logs_message_id ON admin_logs(message_id);
