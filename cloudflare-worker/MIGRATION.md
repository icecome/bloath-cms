# D1 数据迁移指南

## 概述

将 blog-comment worker 的 D1 数据库（`blog-comments`）迁移到 Bloath 的新 D1 数据库（`bloath-db`）。

## 前置条件

1. 已在 Cloudflare 创建新的 D1 数据库 `bloath-db`，获取 `database_id`
2. 已将 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases` 段
3. 已登录 wrangler（`wrangler login`）

## 迁移步骤

### 步骤 1：创建新库并运行 migrations

```powershell
cd C:\opt\workstations\project\apps\Bloath\cloudflare-worker

# 本地开发
npm run db:migrate:local

# 远程生产
npm run db:migrate:remote
```

### 步骤 2：从旧库导出数据

```powershell
# 导出旧 blog-comments D1 的全部表
wrangler d1 export blog-comments --remote --output blog-comments-export.sql
```

### 步骤 3：清洗导出文件

导出的 SQL 文件包含 `CREATE TABLE` / `CREATE INDEX` 语句（新库已有），需要只保留 `INSERT` 语句：

```powershell
# 提取所有 INSERT 语句（跳过 DDL）
Select-String -Path blog-comments-export.sql -Pattern '^INSERT INTO' | ForEach-Object { $_.Line } | Out-File -Encoding utf8 blog-comments-data.sql
```

### 步骤 4：导入到新库

```powershell
# 本地
wrangler d1 execute bloath-db --local --file=blog-comments-data.sql

# 远程生产
wrangler d1 execute bloath-db --remote --file=blog-comments-data.sql
```

### 步骤 5：验证数据完整性

```powershell
# 检查留言总数
wrangler d1 execute bloath-db --remote --command "SELECT COUNT(*) as total FROM messages"

# 检查回复总数
wrangler d1 execute bloath-db --remote --command "SELECT COUNT(*) as total FROM replies"

# 检查设置
wrangler d1 execute bloath-db --remote --command "SELECT * FROM app_settings"

# 检查垃圾来源
wrangler d1 execute bloath-db --remote --command "SELECT COUNT(*) as total FROM spam_sources"
```

## 回滚方案

旧库 `blog-comments` 保留不动。如需回滚：
1. 将 Bloath worker 的 D1 binding 切回旧库
2. 或将旧库数据重新导出导入到新库

## 注意事项

- 迁移期间旧 blog-comment worker 仍在线，可随时回切
- `0007_music_sources.sql` 已搬入但音乐源功能未迁移（步骤 4 跳过），表结构会创建但暂无数据写入
- 确认新库数据完整后再下线旧 worker
