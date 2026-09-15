-- ============================================
-- Migration 0004: 历史垃圾来源指纹表
-- 记录被手动标记为垃圾的留言来源(IP/邮箱/昵称/内容指纹),
-- 用于后续新留言的软拦截(自动归入垃圾箱)。
-- 执行命令: wrangler d1 migrations apply blog-comments --remote
-- ============================================

CREATE TABLE spam_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension     TEXT NOT NULL,            -- 'ip' | 'email' | 'nickname' | 'content'
  value         TEXT NOT NULL,            -- ip/email/昵称原文, content 存 SHA256 指纹
  count         INTEGER NOT NULL DEFAULT 0, -- 被手动标垃圾的累计次数
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 同维度同来源唯一, upsert 累计次数
-- 唯一索引最左前缀已覆盖按 dimension 的查询, 无需额外单列索引
CREATE UNIQUE INDEX idx_spam_sources_unique
  ON spam_sources(dimension, value);
