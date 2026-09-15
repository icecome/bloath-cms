-- ============================================
-- Migration 0005: 留言增加访客站点地址 (选填)
-- 执行命令: wrangler d1 migrations apply blog-comments --remote
-- ============================================

ALTER TABLE messages ADD COLUMN visitor_website TEXT DEFAULT '';
