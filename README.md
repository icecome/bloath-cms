# Bloath CMS

Git-based 博客内容管理系统。文章正文与元数据直接以 Markdown 文件形式存在你自己的 GitHub 博客仓库里，CMS 只负责读写与发布编排，不引入自有内容库。

**适合谁**：用 Hugo / Hexo / Astro / Zola / Jekyll / VitePress 等静态站点框架、把内容放在 GitHub 仓库里的博主。单用户自用，管理员白名单限制登录。

**从这里开始**：

- 想干活：[常用命令](#常用命令) → 本地起服务
- 想改代码：先读 [AGENTS.md](AGENTS.md)（分层铁律、硬性规则 R1–R10、已知坑位）
- 想知道为什么这么设计：`docs/` 文档库（本地留存，不入 Git）

## 它做什么

| 能力 | 说明 |
|---|---|
| 内容管理 | 内容库 / 草稿箱 / 回收站三目录约定，等价于 git move 语义 |
| 写作 | Vditor Markdown 编辑器 + 按博客框架自动匹配的 front-matter 表单 |
| 发布 | 多次编辑攒进 S3 缓冲层，点一次「发布」合并为**单个 commit** 写入 GitHub，减少 API 调用与博客 CI 触发次数 |
| 媒体 | 四种后端并行（独立图床仓库 / 博客仓库子目录 / 独立分支 / S3 兼容存储），客户端压缩、视频与安卓动态照片 |
| 部署反馈 | DeployBadge 轮询博客仓库的 GitHub Actions，直接看到站点构建结果 |

内容真源始终是 GitHub 仓库；静态站点由博客仓库自己的 CI 构建，与 CMS 的部署互相独立。

## 技术栈

| 模块 | 技术 |
|---|---|
| `web/` 管理界面 | React 19 + Vite 8 + TypeScript 5.7 + Tailwind CSS 4 + Vditor 3 + react-router 7 |
| `cloudflare-worker/` API 网关 | Hono 4 on Cloudflare Workers + D1（SQLite）+ KV + Zod + aws4fetch |
| `shared/` 前后端共享 | 纯 TS 类型与常量，无运行时代码 |

架构图与机制说明见 `docs/01-architecture/PROJECT_OVERVIEW.md`。

## 目录

```
web/                 管理界面（React SPA）
  src/
    components/      组件，按域分：drafts/editor/layout/media/settings/ui
    contexts/        5 个全局状态 Provider
    hooks/           跨页面逻辑
    lib/             纯逻辑 + 同目录 *.test.ts
    pages/           页面
cloudflare-worker/   API 网关
  src/
    routes/          端点（参数解析 → 调 service → 返回响应）
    services/        业务逻辑 + 零依赖可测模块
    middleware/      CORS / 错误处理 / 路径防护 / 限流 / 会话校验
    lib/             基础设施（响应封装、并发、错误类型、路径校验）
    db/migrations/   D1 迁移（已应用不可修改）
shared/              前后端共享类型
deliverables/        动态照片转码 workflow 与 Python 合成脚本（部署到图床仓库）
docs/                文档库（本地，不入 Git）
```

## 常用命令

```powershell
# 根目录（首次先分别 npm ci）
npm run dev:all        # 前后端并行开发：web vite + worker wrangler dev
npm run typecheck      # 前后端 tsc --noEmit
npm run deploy         # 手动部署；常规发布 push main 由 GitHub Actions 完成

# web/
npm test               # Node 原生 test runner
npm run lint           # eslint
npm run build          # 生产构建

# cloudflare-worker/
npm test               # Node 原生 test runner
npm run db:migrate:local     # D1 迁移（本地 miniflare）
npm run db:migrate:remote    # D1 迁移（生产）
```

## 本地开发的最小配置

1. 复制 `cloudflare-worker/.dev.vars.example` 为 `.dev.vars`，填入 `SESSION_SECRET`（**至少 32 字符，否则服务拒绝启动**）与 `ADMIN_GITHUB_LOGIN`。
2. 建一个 GitHub OAuth App，回调地址指向本地 Worker（默认 `http://localhost:8787/api/auth/callback`）。
3. `npm run dev:all`，浏览器打开 Vite 输出的地址，用白名单内的 GitHub 账号登录。
4. 首次进入后在「设置」里选仓库、确认内容路径与媒体源。配置可以推到仓库的 `.bloath/config.json`，换设备时自动拉取。

S3 凭据只经 HTTPS 提交后加密存于服务端 D1，不写入浏览器存储，也不写入仓库配置。

## 测试与 CI

- 前后端统一使用 Node 原生 test runner（`node --experimental-strip-types --test`），不引入第三方测试框架。
- CI 顺序：typecheck → test → build → Pages → Workers → secrets 注入，见 `.github/workflows/deploy.yml`。
- 本地 Node 版本常高于 CI（CI 固定 22）。改动异步相关代码后，建议用 Node 22 再跑一次测试。

## 开发前必读

`AGENTS.md` 是唯一的项目级编码约定来源，其中的规则来自真实事故，不是风格偏好。最少需要知道的三条：

1. **依赖单向**：`pages → components/contexts/hooks → lib → shared`；worker 侧 `routes → services → lib`。
2. **纯函数必须接返回值**：工具函数返回副本时靠副作用调用会静默失效（已发生过一次，持续 7 周无报错）。
3. **禁止静默失败**：加载失败、初始化失败必须显示给用户，不能只打 console。

## 许可

个人项目，未附开源许可证。
