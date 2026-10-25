# AGENTS.md

本文件是 Bloath CMS 的项目级工程约定，供开发者与 AI 助手在写代码前阅读。按「约定 → 依据 → 边界条件」组织：每条约定给出理由与适用条件，便于后续有依据地调整。

> 项目是什么、怎么跑起来、代码在哪：先读 [docs/01-architecture/PROJECT_OVERVIEW.md](docs/01-architecture/PROJECT_OVERVIEW.md)，本文件只管编码约定。
> 当前挂着的问题：[docs/04-issues/KNOWN_ISSUES.md](docs/04-issues/KNOWN_ISSUES.md)。

---

## 1. 项目速览

- **一句话**：以 GitHub 博客仓库为内容真源的 Git-based CMS，Cloudflare Worker 做 API 网关，React SPA 做管理界面；单人使用姿态。
- **三大部件**：`web/`（React 19 + Vite）、`cloudflare-worker/`（Hono on Workers）、`shared/`（前后端共享类型）。
- **内容流**：编辑 → S3 草稿缓冲 → 发布合并为单 commit 写入 GitHub → 博客仓库自身 CI 构建静态站点。
- **部署**：push `main` 触发 GitHub Actions（测试门禁 → Pages + Workers + secrets 注入），细节见 [docs/05-delivery/RELEASE.md](docs/05-delivery/RELEASE.md)。

## 2. 常用命令

```powershell
npm run dev:all        # 根目录：前后端并行开发
npm run typecheck      # 根目录：前后端 tsc --noEmit
npm test               # web/ 与 cloudflare-worker/ 内各自执行（Node 原生 test runner）
npm run db:migrate:local | db:migrate:remote   # cloudflare-worker/ 内，D1 迁移
```

提交信息用中文（`.trae/rules/git-commit-message.md`）；部署、环境变量与排错见 [docs/05-delivery/](docs/05-delivery/)。

## 3. 前端约定（web/）

### 3.1 最新值 ref（latest-value ref）

在**事件回调或异步回调中读取"最新 props/state"**时，允许在渲染函数体内直接给 ref 赋值：

```tsx
const onInputRef = useRef(onInput);
onInputRef.current = onInput;   // 渲染期写 ref：刻意为之

// 配合空依赖数组的 useCallback，保证回调读到的始终是最新 props
const initialize = useCallback(() => {
  instance.on('input', (v) => onInputRef.current?.(v));
}, []);
```

**依据**：若把回调放入 `useCallback`/`useEffect` 的依赖数组，会导致外部实例（如 Vditor 编辑器）被反复销毁重建。赋值本身幂等，并发渲染下丢弃的分支仅是"写了一次即将被覆盖的值"，无副作用。

**边界条件**（不满足则不适用，应改用 `useEffect` 同步）：

- 读点必须位于**事件回调或异步回调**内；若在渲染输出中直接读取该 ref，则不可使用此模式
- 必须配套**空依赖数组**的 `useCallback`/`useEffect`，否则模式失去意义
- 不得用于承载会被 React 状态驱动的渲染数据

**现有使用点**：`web/src/hooks/useFileListPage.ts:31`、`web/src/components/editor/VditorEditor.tsx:15-19`、`web/src/pages/EditorPage.tsx:341`、`web/src/components/editor/SchemaFormPanel.tsx:544`

### 3.2 异步加载的陈旧响应防护

列表类数据加载必须防止"切换上下文后旧响应覆盖新数据"。项目内采用两种既有范式，优先复用：

```tsx
// 范式 A：cancelled 标志（组件内 effect）
let cancelled = false;
fetchData().then((d) => { if (!cancelled) setData(d); });
return () => { cancelled = true; };
// 见 web/src/pages/DraftsPage.tsx:81-85

// 范式 B：比对身份键（需要在响应中校验上下文未变时）
if (!selectedRepo || selectedRepo.owner !== owner || selectedRepo.repo !== repo) return;
// 见 web/src/components/layout/MainLayout.tsx:416
```

### 3.3 Context value 稳定性

Provider 的 `value` 若为对象字面量，应使用 `useMemo` 包装；其中每个方法应使用 `useCallback`。
**注意**：判定"value 抖动是否传导到下游"时，需逐个检查 value 内**方法自身的依赖数组**——value 对象引用变化不等同于其属性值变化。

### 3.4 可见文案

用户可见文案（界面、错误提示、空状态）遵循克制、准确的中文技术写作规范；改写留痕与边界（不改 console 日志、commit 模板、机器可读字面量）见 [docs/06-reference/文案改写对比清单.md](docs/06-reference/文案改写对比清单.md)。

## 4. 后端约定（cloudflare-worker/）

### 4.1 接口授权

全部业务端点由 `requireAuth` 守卫（CSRF → 会话 Cookie → 解密校验 → 设备指纹比对），实现见 `cloudflare-worker/src/middleware/sessionAuth.ts`。

**注意**：原 `/api/admin/*` 的 `requireAdminAuth`（GitHub 用户名白名单，fail-closed）随留言管理模块一并移除。若将来新增管理类端点，必须重新引入等价的身份白名单，而不是只复用 `requireAuth`——`requireAuth` 的语义是「已登录」，不是「是博主本人」。

### 4.2 存储读取的结构校验

从 D1 `app_settings` 这类**共享表**读取 JSON 值时，应使用 Zod schema 校验结构而非直接类型断言。
依据：该类表可能被运维脚本或其他模块写入，字段类型异常时直接断言会导致 `TypeError` 被外层 catch 静默吞掉，形成难以排查的降级。
参考实现：`cloudflare-worker/src/services/bufferConfig.service.ts` 的 `storedConfigSchema`。

### 4.3 会话吊销

登出除清除 cookie 外，必须推进服务端吊销门槛（`revokeSessions`）。仅清 cookie 无法使已泄露的 token 失效。

### 4.4 并发控制

批量异步操作使用 `cloudflare-worker/src/lib/concurrency.ts` 的 `mapLimit`，避免无上限 `Promise.all`。
注意区分两类语义：`mapLimit` 内任一失败即整体抛出；若需要"部分成功"的结果，使用 `Promise.allSettled` 并显式处理失败项。

### 4.5 错误消息与状态码

前后端间**禁止**用 `err.message.includes('404')` 一类文本匹配判断 HTTP 状态码。
前端统一使用 `web/src/lib/http.ts` 的 `HttpError`，按 `err.status` 数字判断。

### 4.6 通用基础设施位置

API 响应信封与错误码是**编辑器与所有端点共用**的基础设施，位于：

- `cloudflare-worker/src/lib/response.ts` — `success()` / `error()` / `ApiResponse`
- `cloudflare-worker/src/lib/error-codes.ts` — `ErrorCode` 枚举
- `cloudflare-worker/src/lib/api-error.ts` — `ApiError`（业务码 + HTTP 状态）

新增端点一律从这里导入，**不要**再引入模块私有的响应封装。

## 5. 已下线模块

留言管理模块（`routes/{messages,admin,inbound}.ts`、`services/{message,admin,email,inbound,inboundReply,spamSources,rateLimit,turnstile,vectrel}.service.ts`、`comment/` 目录、`web/src/pages/MessagesPage.tsx` 等）已整体移除：该功能移植自独立留言控制台但未完成，原控制台仍在使用，项目内模块从未投产。

对应数据表由 `cloudflare-worker/src/db/migrations/0009_drop_message_tables.sql` 清理；`app_settings` 表保留（缓冲层 S3 配置依赖）。下线过程记录见 [docs/04-issues/wiring-audit-and-message-removal-2026-10-23.md](docs/04-issues/wiring-audit-and-message-removal-2026-10-23.md)。

## 6. 文档体系

文档全部位于 `docs/`（不入 Git），按标准开发流程分六类编号目录；**新增文档必须按类归位并登记进索引**：

| 目录 | 内容 | 入口文件 |
|---|---|---|
| `docs/01-architecture/` | 项目概览、总体架构 | [PROJECT_OVERVIEW.md](docs/01-architecture/PROJECT_OVERVIEW.md) |
| `docs/02-tech-designs/` | 单功能技术设计方案 | — |
| `docs/03-development/` | 开发进展、里程碑、复用日志 | [DEV_LOG.md](docs/03-development/DEV_LOG.md) |
| `docs/04-issues/` | 审查报告、审计、已知问题登记 | [KNOWN_ISSUES.md](docs/04-issues/KNOWN_ISSUES.md) |
| `docs/05-delivery/` | 发布交付、运维排错 | [RELEASE.md](docs/05-delivery/RELEASE.md) / [OPERATIONS.md](docs/05-delivery/OPERATIONS.md) |
| `docs/06-reference/` | 外部参考、对照分析、规范留痕 | — |
| `docs/archive/` | 已完成使命的文档，只读留存 | — |

完整索引与归档规则见 [docs/README.md](docs/README.md)。临时脚本、草稿、一次性验证文件不入 `docs/`，用完即删。
