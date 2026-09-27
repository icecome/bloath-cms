# CODE_REUSE_LOG.md — Bloath CMS

> 复用决策留痕。每次评估记录：评估时间、代码单元、阶梯结论、证据与执行结果。
> 框架：code-reuse-ladder（7 步决策阶梯）

---

## 2026-09 · 首轮全项目复用审计

**评估范围：** `cloudflare-worker/src`、`web/src`、`shared` 全部第一方源码
**执行方式：** 主代理逐文件阅读 + 全库语义检索（子代理并行路径因 API 错误不可用）

### 零成本预检结果（第 3、4 步）

| 检查项 | 结论 |
|--------|------|
| 项目是否已安装通用工具库（lodash / date-fns / ramda 等） | 否。web 侧仅 7 个运行时依赖，worker 侧 4 个，依赖面克制 |
| 标准库可覆盖的场景 | 日期格式化（`Intl.DateTimeFormat` 已在 `vectrel.service.ts:49` 正确使用）、数组去重（`Set`）、`Map` 有序淘汰（`fileCache.ts:31-34` 已用） |
| 原生 API 可覆盖的场景 | `AbortSignal.timeout()` 已在 worker 侧多处使用（`email.service.ts:113`、`turnstile.service.ts:10`、`vectrel.service.ts:26`）；但 web 侧因需兼容旧浏览器仍用手写 `AbortController` + `setTimeout` |
| 结论 | 标准库与原生 API 覆盖度良好，**无引入新第三方依赖的必要** |

### 阶梯评估记录

---

#### [R-1] HTTP 请求客户端

| 字段 | 内容 |
|------|------|
| 位置 | `web/src/lib/api.ts:33-82`（`apiFetch`）vs `web/src/lib/http.ts:23-64`（`requestJson`） |
| 当前实现 | 两套并行的 fetch 封装，各自处理超时 / 401 / 响应信封解析 |
| **阶梯结论** | **Step 2 — REUSE_EXISTING** |
| 复用证据 | `web/src/lib/http.ts:23` `requestJson`，已被 `bufferApi.ts:9`、`commentApi.ts:8` 复用 |
| 证据核验 | `grep "requestJson"` → 4 处（定义 1 + 调用 3）；`grep "apiFetch" api.ts` → 18 处；已读两文件完整实现 |
| 迁移成本 | M（< 1 人日） |
| 破坏性变更 | 否（`apiFetch` 为模块私有，未导出） |
| 测试覆盖 | `requestJson` 无直接测试；`parseEnvelope` 有 4 个用例（`http.test.ts`） |
| 优先级 | **HIGH** |
| 建议 | `apiFetch` 委托给 `requestJson`，将 `skipDataCheck` 提升为其选项；删除 7 处重复的 `AbortController` 样板；补测超时 / 401 / 非 JSON 分支 |

---

#### [R-2] 留言数据结构定义

| 字段 | 内容 |
|------|------|
| 位置 | `cloudflare-worker/src/comment/types.ts:13-33`（`MessageRow`）、`web/src/lib/commentApi.ts:22-40`（`AdminMessage`） |
| 当前实现 | 同一 messages 表行结构在前后端各定义一次，字段名与类型完全一致 |
| **阶梯结论** | **Step 2 — PARTIAL_REUSE** |
| 复用证据 | `shared/types.ts` 共享机制已建立且验证可用：`RepoInfo`(1-5)、`CommitOp`(147-158)、`FRONTMATTER_YAML_REGEX`(161) 均被前后端成功复用 |
| 证据核验 | 已逐字比对两侧字段，仅差 `reply_token`（worker 独有）/ `replies`（web 独有）；`grep "MessageRow"` → worker 侧 10 处；`grep "AdminMessage"` → web 侧 6 处 |
| 迁移成本 | M（< 1 人日，涉及 6 个 import 点） |
| 破坏性变更 | 是（类型定义位置变更） |
| 测试覆盖 | 类型定义无需测试；需确认 `messagesThread.ts:46` `buildThread` 行为不变 |
| 优先级 | **HIGH** |
| 建议 | 在 `shared/types.ts` 提取 `MessageRecord` 基础接口，两侧用交叉类型补充独有字段。注意 `cloudflare-worker/tsconfig.json:14` 的 include 已覆盖 `../shared/**/*.ts`，无需额外配置 |
| 附带发现 | `CreateMessageInput` 在 `comment/types.ts:48`（interface）与 `utils/validators.ts:42`（`z.infer`）**双定义**，且 `message.service.ts:20` 用 `as` 断言掩盖差异。应保留 Zod 推断版本为单一真源，删除 interface |

---

#### [R-3] 并发分块控制

| 字段 | 内容 |
|------|------|
| 位置 | `cloudflare-worker/src/services/buffer.service.ts:58-69`（`mapLimit`） |
| 当前实现 | 自研 worker-pool 式并发控制器（游标 + 固定 worker 数 + 保序返回） |
| **阶梯结论** | **Step 6 — INLINE_ONE_LINE（内部复用）** |
| 复用证据 | 存在三种同语义实现：`buffer.service.ts:58` 的 `mapLimit`、`github.ts:580-602` 的 `for` + `Promise.all` 分块、`extractFrontMatter.ts:140-148` 的同型分块 |
| 证据核验 | `grep "Promise.all(\|mapLimit\|CONCURRENCY\|batchSize\|CHUNK_SIZE"` → 18 处命中 |
| 迁移成本 | S（< 1 小时） |
| 破坏性变更 | 否 |
| 测试覆盖 | 三处调用点均无测试 |
| 优先级 | **MEDIUM** |
| 第 5 步否决记录 | 评估过 `p-limit`。**结论 THIRD_PARTY_SKIP**：项目当前运行时依赖极克制（worker 侧仅 4 个），为 3 个调用点引入新依赖不划算；且 `mapLimit` 实现正确，无需外部替代 |
| 建议 | 将 `mapLimit` 提升到 `cloudflare-worker/src/lib/` 作为共享工具，另两处改用 |

---

#### [R-4] 日期格式化

| 字段 | 内容 |
|------|------|
| 位置 | 六处独立实现（见下表） |
| 当前实现 | `pad2`/`padZero` 两份等价实现 + 四份格式拼接逻辑 |
| **阶梯结论** | **Step 3 — USE_STDLIB（部分场景）** |
| 复用证据 | `Intl.DateTimeFormat` 已在 `vectrel.service.ts:49` 正确使用；`toLocaleString` 已在 `messagesThread.ts:27,37` 正确使用 |
| 证据核验 | `grep "getFullYear()"` → web/src 下 8 个文件；`grep "^function pad\|^export function format(Date\|Time)"` → 6 个定义点 |
| 迁移成本 | S（< 1 小时） |
| 破坏性变更 | 否 |
| 测试覆盖 | `path.ts` 的 `formatYyyymmdd`/`formatHhmmss` 有测试（`path.test.ts:32-77`） |
| 优先级 | **LOW** |
| 建议 | `pad2`(`path.ts:23`) 与 `padZero`(`rename.ts:1`) 合并导出一份。语义不同的不建议强行合并（`api.ts:22` `formatTimestamp` 产出紧凑时间戳用于 commit message；`mediaUtils.ts:68` `formatDate` 产出 UI 展示格式）。改动需保持 `path.test.ts` 通过 |

| 文件 | 行号 | 函数 | 用途 |
|------|------|------|------|
| `web/src/lib/api.ts` | 22 | `formatTimestamp` | commit message 时间戳 |
| `web/src/lib/mediaUtils.ts` | 68 | `formatDate` | 媒体文件时间展示 |
| `web/src/lib/messagesThread.ts` | 27 | `formatTime` | 留言相对时间 |
| `web/src/lib/messagesThread.ts` | 37 | `formatFullTime` | 留言完整时间 |
| `web/src/components/editor/SchemaFormPanel.tsx` | 56 | `formatDate` | datetime 输入框 |
| `web/src/lib/path.ts` | 23 | `pad2` | 文件名日期 |
| `web/src/lib/rename.ts` | 1 | `padZero` | 重命名模板 |

---

#### [R-5] 死代码清理

| 字段 | 内容 |
|------|------|
| 位置 | `web/src/lib/fileCache.ts:52-54`（`clearAllCache`）、`:38-42`（`clearCache` 的 `basePath` 分支）、`cloudflare-worker/src/comment/utils/sanitizer.ts:1-3`（`sanitizeInput`） |
| 当前实现 | 三个导出 / 分支从未被调用 |
| **阶梯结论** | **Step 1 — SKIP（反向应用：应删除）** |
| 复用证据 | 无（正因无复用价值才建议删除） |
| 证据核验 | `grep "clearAllCache"` → 1 命中（仅定义）；`grep "clearCache"` → 12 处调用全部单参数；`grep "sanitizeInput"` → 1 命中（仅定义） |
| 迁移成本 | S（< 1 小时） |
| 破坏性变更 | 否（无调用点） |
| 优先级 | **LOW** |
| 建议 | 删除 `clearAllCache` 与 `clearCache` 的未用参数。`sanitizeInput` 若保留则改名 `escapeHtmlAndTrim`，因其只做实体转义、非 HTML 白名单清洗 |

---

#### [R-6] 自研 Markdown 渲染器

| 字段 | 内容 |
|------|------|
| 位置 | `web/src/lib/markdown.ts:33-129` vs `cloudflare-worker/src/services/email.service.ts:41-78` |
| 当前实现 | 前端 129 行正则渲染器；后端 `markdown-it`（`package.json:16` 已装） |
| **阶梯结论** | **Step 5.1 — USE_EXISTING_DEP（推荐但不强制）** |
| 复用证据 | `markdown-it` 已在 worker 子项目声明；若前端复用需新增约 100KB 依赖（gzip 约 30KB） |
| 证据核验 | 已读两侧完整实现；`grep "renderMarkdown"` → 前端 3 处、后端 4 处 |
| 迁移成本 | M（< 1 人日） |
| 破坏性变更 | 是（渲染输出格式可能变化，影响留言展示） |
| 测试覆盖 | 两侧均无测试 |
| 优先级 | **LOW** |
| 权衡说明 | 属权衡决策而非缺陷。前端已在用 `React.lazy` 懒加载 `EditorPage`（`App.tsx:20`），表明团队在意包体积。**但两处同名函数语义不同是明确维护隐患**，最低成本的改进是重命名前端版本为 `renderMessageMarkdown` |
| 安全说明 | 当前前端实现先转义 HTML 再拼接标签，链接经协议白名单过滤（`markdown.ts:26`），无可利用 XSS 路径；后端传入的已是剥离标签的纯文本（`inbound.service.ts:56-70`） |

---

#### [R-7] 后端 GitHub API 请求封装

| 字段 | 内容 |
|------|------|
| 位置 | `cloudflare-worker/src/services/github.ts:420-435`（`githubApi`） |
| 当前实现 | 已有统一封装（JSON 收发 + Authorization/User-Agent 头 + 错误处理） |
| **阶梯结论** | **Step 2 — REUSE_EXISTING（未被充分利用）** |
| 复用证据 | `githubApi` 定义在 `github.ts:420`，但同文件 8 个函数绕过它 |
| 证据核验 | 已逐个阅读：`readFile`(152)、`writeFile`(191)、`deleteFile`(245)、`listDir`(288)、`getRepoBranches`(322)、`createBranch`(362)、`dispatchWorkflow`(623)、`getTree`(654) 均为手写 `fetch` + 重复头 + 重复 `throwGithubError` |
| 迁移成本 | M（< 1 人日） |
| 破坏性变更 | 否（`githubApi` 为模块私有） |
| 测试覆盖 | 无 |
| 优先级 | **MEDIUM** |
| 建议 | 8 个函数改走 `githubApi`。注意 `dispatchWorkflow` 与 `githubApi` 的差异：前者成功返回 204 无响应体，复用需传 `expectNoContent: true` 类选项，否则会 `response.json()` 解析失败 |
| 复杂度差异说明 | 部分函数（如 `getTree` 的 `mode='filename'` 分支）包含分页与部分失败的容错逻辑，属该函数特有，复用封装后仍保留 |

---

### 本轮复用审计小结

| 结论类型 | 数量 | 条目 |
|---------|------|------|
| SKIP（应删除） | 1 | R-5 |
| REUSE_EXISTING | 2 | R-1、R-7 |
| PARTIAL_REUSE | 2 | R-2、R-3（内部复用） |
| USE_STDLIB | 1 | R-4 |
| USE_EXISTING_DEP | 1 | R-6 |
| THIRD_PARTY_SKIP | 1 | R-3 的第 5 步否决记录 |

**总体判断：** 项目的复用基础良好 — `shared/` 共享类型机制、`http.ts` 共享客户端、`config.ts` 集中常量都证明团队有复用意识。本轮发现的问题集中在**"机制已建立但未全面贯彻"**：共享类型机制未被留言模块采用、共享 HTTP 客户端只被 2/3 的 API 模块采用、共享并发控制器根本不存在。

**无新增依赖建议。** 所有复用路径都能在现有代码内部解决。

### 后续跟踪

- [ ] R-1 执行后，需在下一轮回归审查中独立验证 `apiFetch` 的 `skipDataCheck` 语义是否完整保留（`logout`、`deleteFile`、`createBranch`、`setDeviceTrusted`、`triggerDeploy` 共 5 处依赖该语义处理 void 响应）
- [ ] R-2 执行后，需验证 `messagesThread.ts:46` `buildThread` 与 `MessagesPage.tsx` 的类型消费不受影响
- [ ] R-3 执行后，需验证 `mapLimit` 与 `Promise.all` 分块在**错误传播语义**上的差异：`mapLimit` 中任一 `fn` 抛错会经 `Promise.all(workers)` 向上传播，与现有 `github.ts` 中捕获到 `errors` 数组的行为不同，改造时需保留各自容错策略

---

## 2026-09 · 第 2 轮复用审计（子代理交叉验证）

**评估范围：** 同上，由 4 个独立子代理分片复查（安全核心 / 业务服务与路由 / web lib 与 pages / 组件与 contexts），每条结论经主代理复验。
**本轮目的：** 验证第 1 轮结论 + 补充遗漏的复用机会。

### 第 1 轮结论复验

| 条目 | 复验结论 | 修正内容 |
|------|---------|---------|
| R-1（HTTP 客户端） | 成立 | **补充**：`requestJson` 有外部 signal 转发（`http.ts:31-34`）而 `apiFetch` 无；`apiFetch` 有 503 分支（`api.ts:58-60`）而 `requestJson` 无 → 合并需**双向补齐**，非单方向迁移 |
| R-2（留言类型） | 成立 | **精确化**：`AdminMessage` = `MessageRow` 去掉 `user_agent`/`client_hash`/`reply_token` 后加 `replies`。`grep \bMessageRow\b` = 12 处（全 worker）、`grep \bAdminMessage\b` = 4 处（全 web） |
| R-3（并发分块） | 成立，**清单不全** | 实为 **4 处**：`buffer.service.ts:58`（worker 池）、`github.ts:580`（chunk+all）、`extractFrontMatter.ts:140`（chunk+all）、`github.ts:477-487`（**无上限** `Promise.all`，本轮新发现） |
| R-4（日期格式化） | 成立，**清单不全** | 实为 **8 处**：新增 `EditorPage.tsx:147`、`SchemaFormPanel.tsx:70-75`（`toDatetimeInputValue`） |
| R-5（死代码） | 成立 | **扩展**：本轮另在 `shared/types.ts` 查出 3 个死类型（见 R-9） |
| R-6（Markdown 渲染器） | 成立 | **实证差异**：后端 `linkify:true` 自动链接裸 URL、`breaks:true` 单换行成 `<br>`；前端两者皆无 → 同一留言站内与邮件渲染结果**不同**（功能性不一致，非仅命名问题） |
| R-7（githubApi 封装） | 成立，**计数修正** | 绕过点为 **9 处**（第 1 轮漏计 `getUserInfo:85`、`getUserRepos:123`） |

### 第 2 轮新增复用单元

---

#### [R-8] 结构化 HTTP 错误类型

| 字段 | 内容 |
|------|------|
| 位置 | `web/src/lib/api.ts:66-80`（`apiFetch` 的错误抛出）、`web/src/lib/http.ts:57-62`（`requestJson` 的同型逻辑） |
| 当前实现 | 错误以字符串形式抛出 `HTTP ${status}: ${statusText}`，调用方靠 `message.includes('404')` 反解状态码 |
| **阶梯结论** | **Step 6 — INLINE_ONE_LINE**（引入一个约 8 行的错误类） |
| 复用证据 | 无现成实现。但这是**消除现有反模式**的必要前置：`web/src/pages/TrashPage.tsx:48`、`web/src/lib/repoConfigSync.ts:19-22` 两处依赖消息文本 |
| 证据核验 | 已读 `api.ts:66-80`：**仅当 content-type 非 JSON 时**（`:69`）才抛含状态码的消息；JSON 信封路径走 `parseEnvelope`（`:77`）抛业务 message。已读 `http.ts:57-62` 同型。已读 Worker 侧 `errorHandler.ts:12` 确认返回 JSON 信封 → **`TrashPage.tsx:48` 的 `includes('404')` 分支永不命中** |
| 迁移成本 | S（< 1 小时） |
| 破坏性变更 | 否（新增类型，调用方渐进迁移） |
| 测试覆盖 | `parseEnvelope` 有测试；`apiFetch`/`requestJson` 的错误分支无测试 |
| 优先级 | **HIGH**（与其他项不同，此项修复的是一个**已确认失效**的判断逻辑） |
| 建议 | 定义 `class HttpError extends Error { constructor(public status: number, message: string) }`，在 `apiFetch`/`requestJson` 的所有 `throw new Error(\`HTTP ${res.status}...\`)` 处改用，然后调用方改为 `err instanceof HttpError && err.status === 404`。**与 R-1 是同一次重构，应合并实施** |

---

#### [R-9] `shared/types.ts` 死类型清理

| 字段 | 内容 |
|------|------|
| 位置 | `shared/types.ts:11-22`（`ContentEntry`）、`:24-32`（`Collection`）、`:95-100`（`ContentListParams`） |
| 当前实现 | 三个导出接口，引用数均为 0 |
| **阶梯结论** | **Step 1 — SKIP（反向应用：应删除）** |
| 复用证据 | 无（正因无引用才删） |
| 证据核验 | 逐导出 grep 计数：`\bContentEntry\b` → 1 处（仅定义行）；`\bCollection\b` → 1 处（仅定义行）；`\bContentListParams\b` → 1 处（仅定义行）。**对照活跃类型**：`FieldConfig` → 14 处、`ShowWhen` → 2 处、`CommitOp` → 11 处、`RepoInfo` → 40 处 |
| 迁移成本 | S（< 1 小时） |
| 破坏性变更 | 否（无引用） |
| 测试覆盖 | 类型无需测试 |
| 优先级 | **LOW** |
| 方法说明 | 判定标准：**命中数 == 定义行数** 即为死类型。该方法是本轮子代理提出并被主代理验证有效——第 1 轮"shared 复用机制良好"的结论因此暴露出盲区（只看了活跃类型，未做全量引用计数） |

---

#### [R-10] 并发分块的第 4 处无上限实现

| 字段 | 内容 |
|------|------|
| 位置 | `cloudflare-worker/src/services/github.ts:477-487` |
| 当前实现 | `await Promise.all(binaryOps.map(async (op) => {...}))` —— **无并发上限** |
| **阶梯结论** | **Step 6 — 复用 R-3 的 `mapLimit`** |
| 复用证据 | `buffer.service.ts:58-69` 的 `mapLimit`（worker 池模型，可指定上限） |
| 证据核验 | 已读 `github.ts:476-487`：`binaryOps` 来自 `ops.filter(op => op.op === 'write' && op.base64Content)`，其数量受 `repos.ts:120` 的 `ops.length > 200` 校验约束 → 最多 200 个并发 blob 上传 |
| 迁移成本 | S（并入 R-3） |
| 破坏性变更 | 否 |
| 测试覆盖 | 无 |
| 优先级 | **MEDIUM** |
| 建议 | 与其他三处一并改用 `mapLimit`。注意：**此项与 R-3 的另三处语义不同** —— 本处是"全部并发、需全部成功"（任一失败即整批失败），而 `mapLimit` 只保证有序返回。改造时须保留 "任一失败则整体抛出" 的语义（`mapLimit` 内部 `Promise.all(workers)` 恰好满足，因其不会吞错） |

---

### 第 2 轮复用审计小结

| 结论类型 | 第 1 轮 | 第 2 轮新增 | 累计 |
|---------|--------|-----------|------|
| SKIP（应删除） | 1 | 1（R-9） | 2 |
| REUSE_EXISTING | 2 | 0 | 2 |
| PARTIAL_REUSE | 2 | 0 | 2 |
| USE_STDLIB | 1 | 0 | 1 |
| USE_EXISTING_DEP | 1 | 0 | 1 |
| INLINE_ONE_LINE | 0 | 1（R-8） | 1 |
| THIRD_PARTY_SKIP | 1 | 0 | 1 |

**第 2 轮核心发现：** 第 1 轮的复用诊断方向正确（"机制已建立但未全面贯彻"），但**清单完整性不足** —— 并发分块漏计 1 处、日期格式化漏计 2 处、`githubApi` 绕过点漏计 2 处。这说明单轮审查的清单类发现需要**交叉验证**才能补全。

**新增的高价值项是 R-8**：它不是一个"可优化项"，而是一个**已确认失效的判断逻辑**（`TrashPage.tsx:48` 的 404 分支永不命中）。这类"代码看起来在防错、实际从未生效"的缺陷，靠静态阅读单文件很难发现，必须串联"错误抛出方"与"错误消费方"两侧才能确认。

**无新增依赖建议**（累计 2 轮均未建议引入第三方包）。

### 后续跟踪（第 2 轮追加）

- [ ] R-8 执行后，需 grep 复查是否还有遗漏的 `message.includes(` 文本判断（当前已知 2 处：`TrashPage.tsx:48`、`repoConfigSync.ts:19-22`；`grep -n "message\.includes\(" web/src` 确认全库仅此 2 处）
- [ ] R-9 执行后，需跑 `npm run typecheck` 双向确认（web 与 worker 的 tsconfig 都 include 了 `shared/`）
- [ ] R-10 执行后，需验证 `batchCommit` 的失败语义不变：任一二进制 blob 上传失败必须导致整个 commit 中止，而非部分成功
- [ ] **R-1 + R-8 的合并重构**，需独立验证 `apiFetch` 的 503 分支（`api.ts:58-60`）与 `skipDataCheck` 语义在迁移后完整保留 —— 这两项是 `apiFetch` 独有的，`requestJson` 原本没有

---

## 2026-09 · 第 3 轮：修复实施（复用建议的执行结果）

> 本节记录在修复批次中对本日志各项建议的实际执行情况与结果。

### 已执行的复用建议

| 条目 | 建议 | 执行结果 | 提交 |
|------|------|---------|------|
| R-1（HTTP 客户端） | `apiFetch` 复用 `requestJson` | **已执行**。采用"能力下沉"而非直接替换：为 `requestJson` 补 503/204/`skipDataCheck`，`apiFetch` 退化为 3 行包装，18 处调用点零改动。删除 6 处 `AbortController` 样板 | `04996a9` |
| R-2（留言类型） | 提取到 `shared/types.ts` | **已执行**。新增 `MessageRecord`/`MessageReplyRow`/`MessageStatus`；worker 的 `MessageRow` 与 web 的 `AdminMessage` 改为派生；同时删除 `CreateMessageInput` 的重复 interface 与 `as` 断言 | `04996a9` |
| R-3（并发分块） | 提取共享 `mapLimit` | **已执行**。新建 `cloudflare-worker/src/lib/concurrency.ts`；`buffer.service` 与 `github.extractFrontMatters` 改用它；`batchCommit` 的 blob 上传从无上限并发改为限流 8（即 R-10） | `04996a9` |
| R-5（死代码） | 删除 | **已执行**。`clearAllCache`、`clearCache` 的未用参数、`sanitizeInput` 均已删除 | `9389fcb` |
| R-7（githubApi 封装） | 8 处改走 `githubApi` | **部分执行（保守方案）**。经评估，统一改用 `githubApi` 会改变对外错误消息（从语义化文案变为 `GitHub API GET <url>`），属行为变更。改为**提取 `ghHeaders()` 统一下 12 处裸 header 构造**，保留各自错误文案 | `04996a9` |
| R-9（shared 死类型） | 删除 | **已执行**。`ContentEntry`、`Collection`、`ContentListParams` 三个死类型已删除（删除前再次确认引用数为 0） | `9389fcb` |
| R-8（结构化 HTTP 错误） | 引入 `HttpError` | **已执行**。定义于 `http.ts`（共享位置），`apiFetch`/`requestJson` 的错误全部携带 status；`TrashPage` 与 `repoConfigSync` 改用 `err.status === 404` 判断 | `61184cf`、`04996a9` |
| R-4（日期格式化） | 合并 `pad2`/`padZero` | **部分执行**。`path.ts` 导出 `pad2`，`rename.ts` 改为导入；语义不同的 4 个格式化函数按分析保留 | `9389fcb` |
| R-6（Markdown 渲染器） | 前端复用 markdown-it 或改名 | **未执行**。属权衡决策而非缺陷，前端引入 markdown-it 会增加约 30KB gzip；改名同样触及 MessagesPage 的 3 处引用。列入后续 | — |

### 执行中的关键发现

**R-1 的"能力下沉"模式值得记入惯例**：两个同语义模块合并时，若双方各有独有能力，直接替换会丢失功能。正确做法是把能力**下沉到被复用的那一方**，再让另一方退化为包装——这样所有调用点零改动，且下游模块（`bufferApi`/`commentApi`）顺带受益。

**R-8 在实施中触发了一个测试失败**：`HttpError` 最初用 TS 参数属性（`constructor(public status: number)`）编写，而 web 侧测试以 `node --experimental-strip-types` 运行（strip-only 模式不支持该语法），导致测试文件加载失败。改为显式属性赋值后恢复。**教训：共享模块若被测试链路引入，需注意 strip-only 模式的语法限制。**

### 复用收益量化

| 指标 | 修复前 | 修复后 | 变化 |
|------|-------|-------|------|
| `Authorization` 裸构造（`github.ts`） | 12 处 | 1 处（`ghHeaders` 定义） | -11 |
| `AbortController` 超时样板（`api.ts`） | 6 处 | 0 | -6 |
| `buffer.ts` 路径校验样板 | 6 组 | 2 个辅助函数 | -4 组 |
| 留言类型定义 | 3 处 | 1 处（`shared/types.ts`） | -2 |
| 并发分块实现 | 4 处 | 1 处（`lib/concurrency.ts`） | -3 |
| 死代码函数/类型 | 6 个 | 0 | -6 |
| B3 批次净行数 | — | — | **-90 行** |

**结论：两轮复用审计的建议中，7 条已执行、2 条部分执行（保守方案）、1 条未执行（权衡决策）。累计消除约 30 处重复实现，净减少 90 行代码。**

### 后续跟踪（第 3 轮追加）

- [ ] R-6 的决策待定：若前端包体积允许，用 markdown-it 替换自研渲染器可消除两套 Markdown 语义（当前站内与邮件的渲染结果不同）
- [ ] R-7 的完整方案（统一走 `githubApi`）需先确定对外错误消息是否允许变更，属产品决策
- [ ] `lib/concurrency.ts` 的 `mapLimit` 目前仅 worker 侧使用；web 的 `extractFrontMatter.batchFetchFallback` 仍是 `for` 分块实现，可考虑跨包共享（需评估构建链路成本）
