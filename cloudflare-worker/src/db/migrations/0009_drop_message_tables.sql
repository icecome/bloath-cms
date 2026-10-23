-- ============================================
-- Migration 0009：移除留言管理模块的数据表
--
-- 背景：留言管理功能移植自独立留言控制台，移植未完成且该控制台仍在独立运行，
-- 本项目内的留言模块从未投入使用。经决策不再移植，故清理其专属表。
--
-- 保留：app_settings（缓冲层 S3 配置依赖，见 services/bufferConfig.service.ts）
-- 保留：webdav_sources / navidrome_sources / playlist_cache（音乐域，与本模块无关）
--
-- 历史 migration（0001-0008）保持原样：D1 以文件名记录已应用迁移，
-- 删除历史文件会破坏迁移链的连续性。本文件为唯一的下线动作。
-- 执行命令：wrangler d1 migrations apply bloath-db --remote
--
-- ⚠️ 删除顺序至关重要：admin_logs 与 replies 都有 FOREIGN KEY → messages(id)，
-- 必须先删子表再删父表，否则触发 SQLITE_CONSTRAINT_FOREIGNKEY（code 7500）。
-- 首版迁移误将 messages 放在子表之前，远程执行报 FK 失败（事务已回滚，无表被删）。
-- ============================================

-- 1. 先删引用 messages 的子表
DROP TABLE IF EXISTS admin_logs;
DROP TABLE IF EXISTS admin_logs_new;   -- 0002 中已 RENAME 为 admin_logs，通常不存在
DROP TABLE IF EXISTS replies;

-- 2. 再删父表 messages
DROP TABLE IF EXISTS messages;

-- 3. 无外键依赖的独立表
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS spam_sources;
DROP TABLE IF EXISTS webhook_events;   -- Resend 入站邮件幂等去重（留言回信专用）
