# AGENTS.md — Bloath CMS

> Git-based CMS：文章内容直接存储在用户的 GitHub 博客仓库中。
> 优先级：用户当前指令 > 本文件 > docs/ 下文档。本文件只写编码约定和文档入口；架构与实现细节见 docs/，未列出的问题按常规工程判断处理。
> 项目全貌：[docs/01-architecture/PROJECT_OVERVIEW.md](docs/01-architecture/PROJECT_OVERVIEW.md)；当前开放问题：[docs/04-issues/KNOWN_ISSUES.md](docs/04-issues/KNOWN_ISSUES.md)。

## 1. 项目速览

- **定位**：单用户 Git-based CMS，管理员白名单限制登录；内容流程：编辑 → S3 草稿缓冲 → 发布时合并为单个 commit 写入 GitHub → 博客仓库自己的 CI 构建静态站点。
- **技术栈**（已对照各 package.json 核实）：

| 模块 | 技术栈 | 版本 |
|---|---|---|
| `web/` 管理界面 | React + Vite + TypeScript + Tailwind CSS + Vditor + react-router-dom | React 19 / Vite 8 / TS 5.7 |
| `cloudflare-worker/` API 网关 | Hono on Cloudflare Workers + D1 + KV + Zod + aws4fetch | Hono 4 / wrangler 4 |
| `shared/` 前后端共享类型 | 纯 TS 类型（`types.ts`、`profiles.ts`），无运行时代码 | — |

- **测试**：前后端统一 Node 原生 test runner（`node --experimental-strip-types --test`），不引入第三方测试框架。
- **部署**：push `main` 触发 GitHub Actions（typecheck → test → build → Pages + Workers + secrets 注入），见 [docs/05-delivery/RELEASE.md](docs/05-delivery/RELEASE.md)。

**反直觉事实**（先读，防白找）：

1. `docs/` **不入 Git**（`.gitignore` 排除）——本文件里的 docs 链接只在本地工作站有效，clone 出来的仓库没有这个目录。
2. `cloudflare-worker/wrangler.deploy.jsonc` **不在仓库里**：CI 用 `scripts/fill-kv-namespace.mjs` 注入 KV/D1 ID 后生成；本地开发用 `wrangler.jsonc`（D1 id 真实、KV 为占位符）。
3. D1 迁移在 `cloudflare-worker/src/db/migrations/`（**src 下**，不是独立的 `db/` 目录）。
4. web 引用 shared 类型用相对路径 `../../../shared/types`，没有配 alias；worker tsconfig 直接 include `../shared/**/*.ts`。
5. 提交信息用中文（`.trae/rules/git-commit-message.md`，该规则文件同样不入 Git）。

## 2. 目录结构

```
bloath/
├── web/                        # 管理界面（React + Vite）
│   └── src/
│       ├── components/         # 组件，按域分子目录：drafts/editor/layout/media/settings/ui
│       ├── contexts/           # 5 个 Context：Auth/Buffer/Collections/Repo/Toast
│       ├── hooks/              # useAuth/useDraftPreviews/useFileListPage/useMediaLibrary
│       ├── lib/                # 纯逻辑 + 测试（18 个 *.test.ts 与模块同目录）
│       ├── pages/              # 页面组件
│       └── styles/
├── cloudflare-worker/          # API 网关（Hono on Workers）
│   ├── src/
│   │   ├── routes/             # 端点：auth/buffer/mediaS3/repos
│   │   ├── services/           # 业务（19 个模块）；CI 只执行本目录的 *.test.ts
│   │   ├── middleware/         # cors/errorHandler/pathGuard/rateLimit/sessionAuth/writeLimit
│   │   ├── lib/                # 基础设施：api-error/base64/concurrency/error-codes/response
│   │   └── db/migrations/      # D1 迁移（0001–0009，不可修改）
│   ├── scripts/fill-kv-namespace.mjs   # CI 部署时生成 wrangler.deploy.jsonc
│   └── wrangler.jsonc          # 本地 dev 配置（deploy 变体是生成物）
├── shared/                     # 前后端共享类型（无运行时代码）
├── docs/                       # 文档库（不入 Git，仅本地）
└── .github/workflows/deploy.yml
```

| 目录 | 允许存放 | 禁止存放 |
|---|---|---|
| `web/src/lib/` | 纯逻辑工具 + 同名 `.test.ts` | React 组件、API 调用层 |
| `web/src/contexts/` | 全局状态 Provider | 业务组件 |
| `cloudflare-worker/src/services/` | 业务逻辑 + `.test.ts`（CI 只认这里） | HTTP 层细节 |
| `cloudflare-worker/src/routes/` | 参数解析 → 调 service → 返回响应 | 业务逻辑、数据库操作 |
| `shared/` | 纯类型定义 | 运行时代码、依赖任一端的导入 |
| `docs/` | Markdown 文档（见 §10） | 一切入 Git 的东西 |

## 3. 常用命令（2026-10-25 全部实跑核实通过）

```powershell
# 根目录
npm run dev:all        # 前后端并行开发（concurrently：web vite + worker wrangler dev）
npm run typecheck      # 前后端 tsc --noEmit
npm run deploy         # 手动部署（构建前端 + wrangler deploy）；常规部署 push main 即可

# web/ 内
npm test               # Node 原生 test runner，跑 src/lib/*.test.ts（18 个文件）
npm run lint           # eslint（仅 web/ 配置了 lint；worker 没有）

# cloudflare-worker/ 内
npm test               # 跑 src/**/*.test.ts（5 个文件，均在 services/ 下）
npm run db:migrate:local     # D1 迁移（本地）
npm run db:migrate:remote    # D1 迁移（生产）
```

**本地与 CI 的差异**：CI（`.github/workflows/deploy.yml`）worker 测试只跑 `node --experimental-strip-types --test src/services/*.test.ts`——**新测试必须放 `src/services/` 下才会被 CI 执行**；本地 `npm test` 则是 `src/**/*.test.ts` 全量。**Node 版本也不同**：workflow 固定 `node-version: '22'`，本地常见 v24，事件循环排空时机这类差异只在 CI 暴露（见 §9）。web/worker 测试都带 `--test-reporter=spec`，非 TTY 环境下不再吐 TAP 巨量日志。

本地环境变量模板：`cloudflare-worker/.dev.vars.example`；部署与排错见 [docs/05-delivery/](docs/05-delivery/)。

## 4. 分层铁律（违反即返工）

```
web:  pages → components + contexts/hooks → lib（纯逻辑）→ shared（类型）
worker: routes（端点）→ services（业务）→ lib（基础设施）+ middleware（横切）
```

1. 依赖自上而下单向；禁止反向 import、禁止 lib 调 components、禁止 services 引入 HTTP 层类型。
2. **新增 API 端点 = 新建/扩展 `routes/` 处理函数 + 业务落 `services/` + 响应走 `lib/response.ts` 结构**；不新增模块私有的响应封装。
3. **新增可单测的业务逻辑**：抽成零依赖模块放 `services/`（现有范本：`owner-allowlist.ts`、`git-blob-sha.ts`、`publish-paths.ts`，见各文件头注释），配同目录 `.test.ts`。
4. **新增前端数据获取/状态**：列表页统一复用 `useFileListPage` + `FileTable`（Dashboard 已迁移），不另写加载实现。

## 5. 硬性规则

以下规则来自历次审查与审计中实际修复过的问题（2026-09 两轮代码审查、2026-10-25 产品审计 P0×7/P1×7 全修），遇到同类情况直接遵循，不需要重新讨论：

**R1 身份校验分两层，缺一不可。**
会话签发由 `cloudflare-worker/src/services/owner-allowlist.ts` 的 `isLoginAllowed` 校验（OAuth callback 和 `requireAuth` 中间件都会调用）。fail-closed 语义：白名单已配置时，只允许名单内的账号登录；生产环境未配置时，拒绝所有 OAuth 登录；非生产环境未配置时允许登录（供本地调试）。`requireAuth`（`middleware/sessionAuth.ts`，依次校验 CSRF、会话 Cookie、解密、设备指纹）只能证明「会话有效」，不能证明「是管理员」。新增敏感端点若只套 `requireAuth`，就缺少必要的身份限制。

**R2 凭据只保存在服务端。**
S3 凭据由 D1 加密存储（`services/mediaS3Config.service.ts`，AES-GCM），不写入浏览器 localStorage，也不写入仓库配置：推送 `.bloath/config.json` 时必须移除 `media.s3` 整个对象；从仓库拉取配置时经 `sanitizeSyncedConfig` 清除历史遗留的凭据字段；前端展示 AccessKey 时脱敏显示。

**R3 写入 GitHub 前先校验 SHA。**
写入 contents 前用 `services/git-blob-sha.ts` 校验 contentSha，保证重复执行结果一致，防止用过期的基线覆盖仓库中的新修改；一次发布对应合并后的单个 commit；单次请求的批量路径不超过 40、二进制 ops 不超过 40，超限时分块；目录树超限时返回显式的 413，不做静默截断。

**R4 竞态处理复用既有模式。**
列表加载防止旧响应覆盖新数据（§6.2 两种模式二选一）；同步按钮操作配 ref 动作锁（§6.3）；加载失败时保留旧数据并显示错误状态，不清空列表（`refreshChanges` 已实现）。

**R5 用状态码判断结果，不解析错误文本。**
前端统一使用 `web/src/lib/http.ts` 的 `HttpError`，按 `err.status` 数值判断；禁止 `err.message.includes('404')` 这类文本匹配。API 响应统一使用 `lib/response.ts`、`lib/error-codes.ts`、`lib/api-error.ts` 的结构与错误码，不新增模块私有的响应封装。

**R6 共享表中的 JSON 读取必须做结构校验。**
`app_settings` 等共享表可能被其他模块或脚本写入：读取时用 Zod 的 `schema.safeParse` 校验结构（参考 `services/bufferConfig.service.ts` 的 `storedConfigSchema`）。直接类型断言会让 TypeError 被外层 catch 吞掉，形成难以排查的降级。

**R7 会话安全要求。**
登出必须调用 `revokeSessions` 在服务端记录吊销，使已签发的会话令牌失效（生产环境 KV 读取失败时按已过期处理）；`SESSION_SECRET` 长度至少 32 字符，不满足时服务拒绝启动；会话有 7 天绝对上限，`/api/me` 不延长有效期。

**R8 批量并发必须有上限。**
批量异步操作使用 `lib/concurrency.ts` 的 `mapLimit`（任一失败即整体抛出；需要部分成功的结果时用 `Promise.allSettled` 并显式处理失败项）。禁止不设上限的 `Promise.all`。

**R9 D1 迁移不可逆。**
`src/db/migrations/`（0001–0009）中已应用的迁移文件不得修改，回退方式是新增反向迁移；执行删表类迁移前先确认数据已导出。

**R10 纯函数必须接返回值，禁止靠副作用调用。**
`sortFiles.ts` 的 `sortByFrontMatterDate` / `sortByLastModified` 返回新数组（非破坏性），调用点必须 `const sorted = ...` 后再用于 `setState` / 写缓存。2026-09-09 把这两个函数从原地排序改成返回副本时调用点没同步，文章列表排序静默失效约 7 周（`useFileListPage.ts` 只调用不接收，编译与单测都发现不了）。列表排序**只在 `scanner.ts` 出口做一次**，调用点不再各自补排序；带排序/时间语义的纯逻辑必须配同目录 `.test.ts`，依赖较重时把纯函数抽成零依赖模块（范例 `lib/dateParse.ts`：`sortFiles.ts` 原先的值导入缺 `.ts` 后缀，node ESM 下无法加载，导致长期没有测试）。

## 6. 前端约定（web/）

### 6.1 最新值 ref（latest-value ref）

在**事件回调或异步回调中读取「最新 props/state」**时，允许在渲染函数体内直接给 ref 赋值：

```tsx
const onInputRef = useRef(onInput);
onInputRef.current = onInput;   // 渲染期写 ref：有意为之

// 配合空依赖数组的 useCallback，保证回调读到的始终是最新 props
const initialize = useCallback(() => {
  instance.on('input', (v) => onInputRef.current?.(v));
}, []);
```

**依据**：把回调放进 `useCallback`/`useEffect` 依赖数组会导致外部实例（如 Vditor 编辑器）反复销毁重建。赋值本身幂等，并发渲染下被丢弃的分支只是「写了一次即将被覆盖的值」，无副作用。
**适用条件**（不满足时改用 `useEffect` 同步，参考 `EditorPage.tsx` 的 `handleSaveRef`）：

- 读点必须位于**事件回调或异步回调**内；在渲染输出中直接读取该 ref 时不可使用
- 必须配合**空依赖数组**的 `useCallback`/`useEffect`，否则模式失去意义
- 不用于承载会被 React 状态驱动的渲染数据

**现有使用点**：`web/src/hooks/useFileListPage.ts:29`、`web/src/components/editor/VditorEditor.tsx:36-41`

### 6.2 异步加载时防止旧响应覆盖新数据

列表类数据加载必须防止「切换上下文后旧响应覆盖新数据」，复用两种既有模式：

```tsx
// 模式 A：cancelled 标志（组件内 effect）
let cancelled = false;
fetchData().then((d) => { if (!cancelled) setData(d); });
return () => { cancelled = true; };
// 见 web/src/hooks/useFileListPage.ts:48-69、web/src/pages/DraftsPage.tsx:120-124

// 模式 B：比对身份键（响应返回后校验上下文未变）
if (!selectedRepo || selectedRepo.owner !== owner || selectedRepo.repo !== repo) return;
// 见 web/src/components/layout/MainLayout.tsx:506
```

### 6.3 同步动作锁

写操作类按钮（发布、批量删除、保存等）必须配 ref 动作锁，防止双击重复提交：

```tsx
// state 在同一事件循环内读不到更新，第二次点击仍读到旧值；ref 的读写是同步的，可消除这个窗口
const actionLockRef = useRef(false);
const acquireActionLock = useCallback((): boolean => {
  if (actionLockRef.current) return false;
  actionLockRef.current = true;
  return true;
}, []);
```

**依据**：不加锁时第二次 `commitBatch` 会因源文件已不存在而报错，用户看到「失败」提示，但操作实际已生效（此前实际发生过）。
**现有使用点**：`web/src/pages/DraftsPage.tsx:93-104`、`web/src/pages/EditorPage.tsx:317`（保存锁）、`web/src/pages/DashboardPage.tsx:71`。

### 6.4 Context value 稳定性

Provider 的 `value` 若为对象字面量，用 `useMemo` 包装；其中每个方法用 `useCallback`。判断「value 变化是否影响下游」时，需逐个检查 value 内**方法自身的依赖数组**——value 对象引用变化不等同于其属性值变化。

### 6.5 可见文案与失败提示

- 用户可见文案遵循克制、准确的中文技术写作规范；改写留痕与适用范围（不改 console 日志、commit 模板、机器可读字面量）见 [docs/06-reference/文案改写对比清单.md](docs/06-reference/文案改写对比清单.md)。
- **禁止静默失败**：初始化失败、加载失败、配额已满必须显示给用户（重试状态 / ErrorBoundary / toast）。写作主路径上「失败但无任何提示」是最危险的故障形态，参考 `VditorEditor.tsx` 的 `initError` 重试状态。
- 撤销类 toast 不自动关闭（`duration: 0`），撤销窗口 10 分钟。

### 6.6 懒加载路由必须走 LazyRoute

代码分块（`React.lazy` / `import()`）的加载失败是**部署期常态故障**，不是异常分支：

```tsx
const loadEditorPage = () => import('./pages/EditorPage'); // 模块级常量，引用必须稳定

<Route path="editor/*" element={<LazyRoute load={loadEditorPage} fallback={<LoadingFallback />} />} />
```

**禁止直接使用 `React.lazy`**：它的 rejected payload 会被永久缓存，一次取块失败就导致该路由在本次会话内再也打不开，且错误冒到根 ErrorBoundary 会连布局外壳一起打死。`LazyRoute`（`web/src/components/ui/LazyRoute.tsx`）负责加载状态、就地重试与失败提示，恢复策略在 `web/src/lib/chunkRecovery.ts`：分块类错误重试 2 次 → 仍失败则整页换版本重载一次（60 秒冷却窗口 + 进程内兜底时间戳防刷新循环）→ 冷却窗口内再失败才显示「编辑器没能加载」。**重载发起后必须带兜底超时**（`reloadTimeoutMs`，默认 5 秒）：导航可能被拦截或 no-op，此时按最后一次分块错误失败、交回 UI 重试，不许返回永不 settle 的 promise——待定 promise 本身不构成泄漏（实测闭包可回收），但界面会永远停在加载中且没有错误出口。

判断是否是分块失败用 `isChunkLoadError`（按三引擎错误文案匹配）；**模块内部求值抛出的异常不会被当成加载失败**，因此不会重放真正的代码缺陷。新增其它动态 `import()` 时同样用 `importWithRetry`，`main.tsx` 的 `unhandledrejection` 监听只是漏网兜底。

**依据**：2026-10-26 编辑器偶发整页崩溃（[docs/04-issues/2026-10-26-editor-chunk-load-failure.md](docs/04-issues/2026-10-26-editor-chunk-load-failure.md)）。

## 7. 后端约定（cloudflare-worker/）

- 分层：`src/routes` 端点、`src/services` 业务、`src/middleware` 中间件、`src/lib` 基础设施。
- **可测性**：需要单测的业务逻辑抽成**零依赖模块**（§4 铁律 3），用 `node --experimental-strip-types --test` 直接测试。
- 限流与防护：KV 固定窗口按账号限流（`middleware/rateLimit.ts`）；写操作另有 `writeLimit`；路径防护在 `pathGuard`。
- 限流命中的响应默认是 JSON 错误信封（API 路由）。`/media-file/*` 这类「响应体被浏览器当资源解码」的直链路由必须给 `rateLimit` 传 `onLimit` 返回纯文本 429，否则图片/视频加载失败时拿到的是 `application/json`（2026-10-30 修复）。`Retry-After` 两种格式下都由中间件写入；`onLimit` 内必须用 `c.text()`/`c.json()` 产出响应，裸 `new Response()` 会丢掉该头。
- 树缓存：`CACHE_KV` 可选，按 head-sha 作为键；未配置时跳过缓存，不影响功能。

## 8. 禁止事项

| 禁止项 | 原因 |
|---|---|
| 重新引入留言管理模块 | `routes/messages` 等已于 2026-10-23 移除，未上线使用过；`src/db/migrations/0009_drop_message_tables.sql` 已删表。背景见 [docs/04-issues/wiring-audit-and-message-removal-2026-10-23.md](docs/04-issues/wiring-audit-and-message-removal-2026-10-23.md) |
| 修改已应用的 D1 迁移 | R9：迁移不可逆，回退靠新增反向迁移 |
| 引入第三方测试框架 | 前后端统一 Node 原生 test runner |
| 未经确认新增 npm 依赖 | 优先复用 §6/§7 列出的既有实现 |
| 把 `docs/`、含 PII 的数据、一次性脚本提交进 Git | docs 与 PII 转储属本地内容；临时文件用完即删 |
| 改变 CI 步骤顺序 | typecheck → test → build → Pages → Workers → secrets 注入的顺序有依赖语义（secrets 注入依赖 deploy 配置生成） |
| 把 D1 转储 `*.sql` 放进 `migrations/` 之外的入库路径 | 含访客 PII；`.gitignore` 已挡 `cloudflare-worker/*.sql` 与 `data_split/`，新增转储沿用该模式 |

## 9. 已知坑位

| 坑 | 处置 |
|---|---|
| CI 只跑 `src/services/*.test.ts`，本地 `npm test` 跑全量 | 新测试一律放 `src/services/`；`lib/`、`middleware/` 下的测试 CI 不执行 |
| `wrangler.deploy.jsonc` 找不到 | 它是 CI 生成物（不入 Git）；本地 dev/部署用 `wrangler.jsonc`，别手动创建 deploy 变体 |
| 旧版曾把 S3 凭据写进 `.bloath/config.json` 推送到仓库 | 推送前必须移除 `media.s3` 整对象（R2）；仓库历史污染状态见 KI-06，待用户判断公开性后处置 |
| Vditor 从 jsDelivr CDN 加载，镜像不可用时编辑器挂 | 已知长期风险（KI-03），raw 是回退；排查编辑器白屏先查 CDN 可达性 |
| `wrangler dev` 连的 KV/D1 与生产不同 | 本地用 `--local`（miniflare 模拟）；`db:migrate:local` 只动本地库，remote 才是生产 |
| clone 后没有 `docs/` | `.gitignore` 排除；文档只在本地工作站，链接失效时回到本机 `apps/Bloath/docs/` 找 |
| 生产站开着 Cloudflare Rocket Loader，把 `type="module"` 改写成 `<hash>-module` 后异步注入 | 入口脚本靠 `vite.config.ts` 的 `rocketLoaderOptOut` 插件补 `data-cfasync="false"`（Vite 构建会丢弃该属性，改完必须看 `dist/index.html`）；根治要关 zone 级开关（KI-08） |
| Pages 对未命中的 `/assets/*` 回落 `index.html`（**200 + text/html**） | 旧分块的「404」被伪装成 200 HTML，浏览器只报 `Failed to fetch dynamically imported module`。排查缺块别只看状态码，看 `Content-Type`：拿到 `text/html` 就是回落 |
| `web/public/_headers` 决定产物缓存语义 | `/assets/*` 必须 `immutable`，HTML 必须 `max-age=0`。写反（分块 `max-age=0`）＝每次进编辑器都要回源，部署一换哈希就取不到 |
| 本地 Node v24、CI Node 22（workflow 固定 `node-version: '22'`） | 「事件循环何时排空」这类差异只在 CI 暴露（2026-10-26 run #161 因此红）。改异步相关代码/测试后，把 Node 22 目录前置到 `PATH` 跑一次 `npm test`；不要用「把 CI 升到 v24」来掩盖测试缺陷 |
| 测试里留下未 settle 的 promise，或对兜底定时器 `unref()` | Node 22 的 test runner 见「事件循环已排空但用例 promise 待定」会把在飞用例批量记成 `cancelledByParent`、整步退出码 1。用例必须 `await` 到 settle；定时器保持被引用 |
| 非 TTY 环境下 `node --test` 默认吐 TAP，一轮 2000 行把失败淹没 | `npm test` 与 workflow 的 worker 测试步都带 `--test-reporter=spec`（253 例 1938 行 → 426 行）；新增测试入口沿用该 flag |
| 工具函数改成返回副本（非破坏性）后，靠副作用调用的调用点静默失效 | 列表排序失效事故（2026-09-09 → 10-27）：`sortByFrontMatterDate` 改为 `[...files].sort()` 后 `useFileListPage` 仍只调用不接收，排序空转 7 周且无任何报错。处置见 R10；排序统一在 `scanner.ts` 出口做，`sortFiles.test.ts` 锁死「非空操作 / 全序 / 输入顺序无关」，背景见 [docs/04-issues/2026-10-27-article-list-sort-regression.md](docs/04-issues/2026-10-27-article-list-sort-regression.md) |
| 比较器混用两把排序键（有日期按日期、无日期按文件名）不是合法比较器 | 不满足传递性，可构造 A<B<C<A 的环，V8 TimSort 输出依赖输入顺序且局部逆序。排序键必须**每个元素算一个单键**（`timeSortKey`），同键用 path 兜底 |
| 缺 `.ts` 后缀的值导入让模块在 node ESM 下无法加载，从而写不出单测 | `sortFiles.ts` 原先 `from './extractFrontMatter'`（值导入）→ `ERR_MODULE_NOT_FOUND`，排序逻辑 4 个月无测试覆盖。纯逻辑应抽到零依赖模块并显式带 `.ts` 后缀导入（范例 `lib/dateParse.ts`） |
| YAML/TOML 的时间字段未必是字符串 | `date: 20260707` 被 js-yaml 解析成数字 `20260707`，旧实现原样当毫秒用 → 排序键落到 1970。解析器必须区分 8 位 YYYYMMDD / 10 位秒 / 13 位毫秒（`lib/dateParse.ts`） |

## 10. 文档体系与维护

文档全部位于 `docs/`（不入 Git），按开发流程分编号目录；**新增文档必须放入对应目录并登记进 [docs/README.md](docs/README.md) 索引**：

| 目录 | 内容 | 入口文件 |
|---|---|---|
| `docs/01-architecture/` | 项目概览、总体架构 | [PROJECT_OVERVIEW.md](docs/01-architecture/PROJECT_OVERVIEW.md) |
| `docs/02-tech-designs/` | 单功能技术设计方案 | — |
| `docs/03-development/` | 开发进展、里程碑、复用日志 | [DEV_LOG.md](docs/03-development/DEV_LOG.md) |
| `docs/04-issues/` | 审查报告、审计、已知问题登记 | [KNOWN_ISSUES.md](docs/04-issues/KNOWN_ISSUES.md) |
| `docs/05-delivery/` | 发布交付、运维排错 | [RELEASE.md](docs/05-delivery/RELEASE.md) / [OPERATIONS.md](docs/05-delivery/OPERATIONS.md) |
| `docs/06-reference/` | 外部参考、对照分析、规范留痕 | — |
| `docs/archive/` | 已完成使命的文档，只读留存 | — |

**本文件的维护规则**：

- 事故修复、新坑、架构变更**当次回写**，不等批次整理。
- 修 bug 或重构后，检查 §5 硬性规则与 §9 坑位是否需要增删；规则失效即删，留着比删掉危害大。
- 路径/目录变更时同步更新 §2 目录表（与 docs/README.md 维护规则第 5 条联动）。
- 本文件与其他指令文件的关系：仓库无 CLAUDE.md / .cursorrules，本文件是唯一项目级代理指令源。
