-- ============================================
-- Migration 0006: 通用应用设置表 (KV 风格)
-- 存放控制台可配置的运行时设置 (如博客通知推送的开关与渠道),
-- 变更经管理界面完成, 无需改代码或重新部署。
-- 执行命令: wrangler d1 migrations apply blog-comments --remote
-- ============================================

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,             -- JSON 字符串
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
