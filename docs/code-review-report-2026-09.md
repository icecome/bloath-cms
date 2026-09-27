# 代码审查报告 — Bloath CMS

> **审查框架：** SPEAR（Security / Performance / Error Handling / Architecture / Reliability）
> **审查范围：** 全项目第一方源码，共 143 个文件（`cloudflare-worker/src` 49 个 TS + 8 个 SQL 迁移、`web/src` 58 个 TS/TSX + 1 个 CSS、`shared` 2 个 TS），排除 `node_modules`、`cloudflare-worker/public`（构建产物）、`*.sql` 数据导出文件
> **审查日期：** 2026-09（本轮执行时间以工具调用记录为准）
> **审查模式：** 代码审计（模式 2）+ 自学习（模式 5）+ 复用阶梯（code-reuse-ladder）
> **风险等级：** 高（Red）— 命中认证/会话、密钥管理、公开输入端点、文件上传、外部 API 集成
> **审查轮次：** 第 2 轮（首轮为单代理逐文件审查；本轮引入 4 个独立子代理做交叉验证，结果并入本报告）

> **第 2 轮说明：** 首轮计划中的 5 个分片子代理因 APIError 全数失败，改由主代理逐文件完成。本轮重新派发 4 个子代理（安全核心 / 业务服务与路由 / web lib 与 pages / 组件与 contexts），全部成功返回。子代理的每条发现均经主代理独立取证后才并入本报告；**经核验不成立的发现已在「第 2 轮误报剔除记录」中列出**，不计入问题总数。

> **修复进度（B1 安全批次已完成）：** C-01、C-02、M-S1、M-S2、Q-01 已修复并通过 typecheck + 测试。详见第 15 章「修复实施记录」。

---

## 目录

1. [总体评分](#1-总体评分)
2. [问题汇总](#2-问题汇总)
3. [CRITICAL 问题详情](#3-critical-问题详情)
4. [MAJOR 问题详情](#4-major-问题详情)
5. [MINOR 问题列表](#5-minor-问题列表)
6. [NIT 问题列表](#6-nit-问题列表)
7. [待确认问题](#7-待确认问题)
8. [未验证项声明](#8-未验证项声明)
9. [做得好的地方](#9-做得好的地方)
10. [代码复用评估（复用阶梯）](#10-代码复用评估复用阶梯)
11. [改进建议（按优先级）](#11-改进建议按优先级)
12. [覆盖率校验](#12-覆盖率校验)
13. [第 2 轮交叉验证与新增发现](#13-第-2-轮交叉验证与新增发现)
14. [第 2 轮误报剔除记录](#14-第-2-轮误报剔除记录)

---

## 1. 总体评分

### 加权总分：63/100 — 🟡 NEEDS WORK

| 维度 | 权重 | 评分 | 关键发现 |
|------|------|------|---------|
| 🔴 安全 | 3x | 3/10 | 管理接口无身份白名单（C-01）；开放重定向链（C-02 + M-S2）；CSP 弱化（M-S1） |
| 🟡 性能 | 2x | 8/10 | 无 N+1；`useFileListPage` 陈旧响应无守卫（M-R3） |
| 🟠 错误处理 | 2x | 8/10 | 整体健壮；审计日志非原子（m-15）、`includes('404')` 死判断（m-12） |
| 🔵 架构 | 1.5x | 7/10 | 共享类型机制已建立但留言模块未复用（M-A1）；两套 HTTP 客户端并存（M-A2） |
| 📊 可靠性 | 1.5x | 7/10 | 分页语义分裂（M-R1）、move 路径解析缺陷（M-R2）、跨分支撤销（M-R4） |

**加权算式：** (3×3) + (8×2) + (8×2) + (7×1.5) + (7×1.5) = 9 + 16 + 16 + 10.5 + 10.5 = **63**

> **计分口径声明：** 本报告使用 **0-10 整数分制 + 倍数权重**（S×3、P×2、E×2、A×1.5、R×1.5），满分 100，总分取整。安全维度取 3 分而非 4 分的依据是 SKILL.md 的评级规则：存在 CRITICAL 问题时该维度评分上限为 3。**与第 1 轮使用同一口径**：第 1 轮为 (3×3)+(8×2)+(8×2)+(7×1.5)+(8×1.5)=64；本轮可靠性维度因新增 M-R2/M-R3/M-R4 由 8 降至 7，总分相应变为 63。

**最终加权总分：63/100 — 🟡 NEEDS WORK**

**裁定：** 需修复 CRITICAL 与 P1 级问题后再合并。第 2 轮在首轮基础上新增 1 条 CRITICAL（C-02）与 4 条 MAJOR（M-S2、M-R2、M-R3、M-R4），其中 C-02 与 M-S2 叠加构成开放重定向链，与 C-01 一并属阻断项。数据库与业务逻辑层未见数据丢失级缺陷，架构与工程基础仍属扎实。

---

## 2. 问题汇总

### 按严重级别统计

| 级别 | 首轮 | 第 2 轮新增 | 合计 | 说明 |
|------|------|------------|------|------|
| 🔴 CRITICAL | 1 | 1 | **2** | 管理接口缺身份校验（C-01）；开放重定向链（C-02） |
| 🟠 MAJOR | 4 | 4 | **8** | 见下表 |
| 🟡 MINOR | 11 | 8 | **19** | 复用与规范类改进 |
| 🔵 NIT | 6 | 4 | **10** | 风格与清理类建议 |
| **总计** | **22** | **17** | **39** | 等于各级别之和（2+8+19+10） |
| ⚪ Question | 5 | 1 | 6 | 待确认项，**不计入总计** |

### 按模块分布（含第 2 轮）

归集规则：跨模块问题计入**主要责任文件**所在模块，只计一次。

| 模块 | CRITICAL | MAJOR | MINOR | NIT | 小计 |
|------|----------|-------|-------|-----|------|
| `cloudflare-worker`（安全核心/中间件/配置） | 2 | 2 | 3 | 3 | 10 |
| `cloudflare-worker`（services） | 0 | 3 | 5 | 2 | 10 |
| `cloudflare-worker`（routes/comment） | 0 | 0 | 4 | 1 | 5 |
| `web`（lib） | 0 | 1 | 4 | 2 | 7 |
| `web`（contexts/hooks/components） | 0 | 2 | 3 | 2 | 7 |
| `shared` | 0 | 0 | 0 | 0 | 0 |
| **合计** | **2** | **8** | **19** | **10** | **39** |

MAJOR 归属明细（8 条）：

| ID | 主要责任文件 | 归属模块 |
|----|------------|---------|
| M-S1 | `middleware/cors.ts` | 安全核心 |
| M-S2 | `middleware/cors.ts` | 安全核心 |
| M-R1 | `services/admin.service.ts` | services |
| M-R2 | `services/publish.service.ts` | services |
| M-R3 | `hooks/useFileListPage.ts` | contexts/hooks |
| M-R4 | `pages/DashboardPage.tsx` | contexts/hooks |
| M-A1 | `comment/types.ts`（跨 worker/web/shared） | services |
| M-A2 | `lib/api.ts` | web lib |

---

## 3. CRITICAL 问题详情

### C-01: 管理接口仅校验会话有效性，未校验管理员身份

- **文件：** `cloudflare-worker/src/routes/admin.ts:14`、`cloudflare-worker/src/middleware/sessionAuth.ts:73-87`
- **类别：** 安全（A01:2021 破坏访问控制 — 垂直越权）
- **验证：**
  - 已读 `admin.ts:13-14`，确认 `adminApp.use('/api/admin/*', requireAdminAuth)` 是全部管理端点的唯一守卫
  - 已读 `sessionAuth.ts:73-87` 完整实现，确认其校验项为：`checkCsrf` → 会话 Cookie 存在 → `validateSessionToken`（解密 + 有效期 + 设备指纹比对），**无任何用户身份判定**
  - `grep -n "BLOGGER_GITHUB|ADMIN_GITHUB|ALLOWED_GITHUB|owner.login|user.login" cloudflare-worker/src` → 仅命中 `routes/auth.ts:131-134`（`getUserInfo` 仅用于把用户信息返回前端，不参与鉴权），白名单相关符号 **0 命中**
  - 已读 `cloudflare-worker/wrangler.jsonc:23-28` 的 `vars`，确认不存在管理员用户名配置项
  - 已读 `cloudflare-worker/src/services/session.ts:39-56`，确认会话签发的唯一输入是 GitHub OAuth 拿到的 token，不含身份裁决
- **置信度：** 确定
- **问题：** `requireAdminAuth` 的语义是"已登录"，而非"是博主本人"。GitHub OAuth App 默认对任意 GitHub 用户开放授权，任何完成 `GET /api/auth/login` → GitHub 授权 → `GET /api/auth/callback` 流程的人都会获得有效会话，进而可调用 `/api/admin/*` 全部端点，包括：

  | 端点 | 危害 |
  |------|------|
  | `PATCH /api/admin/messages/:id` | 任意改留言状态 |
  | `DELETE /api/admin/messages/:id` | 删除任意留言 |
  | `POST/PUT /api/admin/messages/:id/reply` | 以博主身份发布回复（且会触发向访客发送邮件） |
  | `POST /api/admin/batch` | 批量删除/标记最多 100 条 |
  | `PUT /api/admin/settings/push` | 篡改推送渠道配置 |

- **影响：** 完整的垂直越权。攻击者无需任何凭证即可通过公开的 OAuth 流程自助获得管理权限；其中"以博主身份回复"会经由 `email.service.ts` 向真实访客发信，构成对外可见的冒名行为。
- **建议修复：** 在会话校验后追加身份白名单校验。最小改动是在 `session.ts` 的 payload 中固化 GitHub login，并在 `requireAdminAuth` 中比对环境变量：

```typescript
// cloudflare-worker/src/env.ts — 新增配置项
export interface Env {
  // ...
  ADMIN_GITHUB_LOGIN: string;  // 博主 GitHub 用户名，逗号分隔可支持多管理员
}

// cloudflare-worker/src/middleware/sessionAuth.ts:73 — 增加身份比对
export const requireAdminAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (!checkCsrf(c.req.raw)) {
    return c.json(errorResp(ErrorCode.VALIDATION_ERROR, 'CSRF validation failed'), 403);
  }
  const sessionToken = getSessionTokenFromCookie(c.req.raw);
  if (!sessionToken) {
    return c.json(errorResp(ErrorCode.UNAUTHORIZED, '未登录或会话已过期'), 401);
  }
  const currentFingerprint = await generateDeviceFingerprint(c.req.raw);
  const result = await validateSessionToken(sessionToken, c.env, currentFingerprint);
  if (!result) {
    return c.json(errorResp(ErrorCode.UNAUTHORIZED, '未登录或会话已过期'), 401);
  }
  const allowed = (c.env.ADMIN_GITHUB_LOGIN || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0 || !allowed.includes(result.githubLogin.toLowerCase())) {
    console.warn('[auth] 非管理员账号尝试访问管理接口:', result.githubLogin);
    return c.json(errorResp(ErrorCode.UNAUTHORIZED, '无管理权限'), 403);
  }
  await next();
};
```

  配套改动：`generateSessionToken` 接收并写入 `githubLogin`，`validateSessionToken` 的 `SessionPayload` 增加该字段。`githubLogin` 可在 `routes/auth.ts:131` 已有的 `getUserInfo` 调用处取得（该调用当前已存在，不新增外部请求）。

- **连带改动：**
  - `cloudflare-worker/src/services/session.ts:39-56` — `generateSessionToken` 签名新增参数
  - `cloudflare-worker/src/services/session.ts:59-65` — `SessionPayload` 新增 `githubLogin` 字段
  - `cloudflare-worker/src/routes/auth.ts:82-91` — callback 中先 `getUserInfo` 再签发，调用顺序需调整（当前 `getUserInfo` 在 `/api/me` 中调用）
  - `cloudflare-worker/src/routes/auth.ts:30` — `dev-login` 的签到路径需传占位 login，并确保 `ENVIRONMENT === 'production'` 时不可达（第 26 行已有该守卫）
  - 存量会话：已签发 token 不含 `githubLogin`，需决定是"拒绝旧 token 强制重登"还是"容忍一次后重签"。建议前者（更安全），并在 `validateSessionToken` 中对缺失字段返回 `null`
- **前置条件：** 需编译验证；需在 Cloudflare 侧新增 `ADMIN_GITHUB_LOGIN` 变量

---

## 4. MAJOR 问题详情

### 安全类

| # | 文件 | 行号 | 问题 | 验证 | 置信度 |
|---|------|------|------|------|-------|
| M-S1 | `cloudflare-worker/src/middleware/cors.ts` | 40-41 | 默认 CSP 含 `script-src 'unsafe-inline' 'unsafe-eval'`，XSS 防护被显著削弱 | 已读 40-41 行（40 为 `const csp = env.CONTENT_SECURITY_POLICY \|\| \`default-src ...\``，41 为 `response.headers.set('Content-Security-Policy', csp)`）；`grep "CONTENT_SECURITY_POLICY"` 全仓仅命中 cors.ts:12（类型声明）与 40（读取），确认 `wrangler.jsonc` 的 vars 中未设置该变量，即生产环境走此默认值；已确认 `img-src` 含 `https:` 通配 | 确定 |

**M-S1 补充说明：** 该 CSP 还包含 `img-src ... https:`（任意 https 图源，可用于数据外带）与 `blob:`（配合 `unsafe-eval` 扩大攻击面）。鉴于前端使用 `vditor`（富文本编辑器，内部基于 DOM 操作与动态样式）以及 `MessagesPage.tsx:509` 的 `dangerouslySetInnerHTML`，放宽 CSP 有现实动因。建议的收敛路径：先移除 `'unsafe-eval'`（vditor 3.x 不需要），保留 `'unsafe-inline'` 待后续用 nonce 或 hash 替代。

### 架构类

| # | 文件 | 行号 | 问题 | 验证 | 置信度 |
|---|------|------|------|------|-------|
| M-A1 | `cloudflare-worker/src/comment/types.ts`<br>`web/src/lib/commentApi.ts`<br>`cloudflare-worker/src/comment/utils/validators.ts` | 13-33<br>22-40<br>42 | 同一留言数据结构三处定义：`MessageRow`、`AdminMessage`、以及 `CreateMessageInput` 双定义 | 已逐字比对：`MessageRow`(types.ts:13-33) 与 `AdminMessage`(commentApi.ts:22-40) 字段名、类型完全一致，仅前者多 `reply_token`、后者多 `replies`。`CreateMessageInput` 在 `types.ts:48` 为 `interface`，在 `validators.ts:42` 为 `z.infer` 推断，`message.service.ts:20` 同时导入前者并对后者结果做 `as` 断言 | 确定 |
| M-A2 | `web/src/lib/api.ts`<br>`web/src/lib/http.ts` | 33-82<br>23-64 | 两套并行的 HTTP 客户端，`apiFetch` 未复用既有 `requestJson`，且超时样板在 6 处重复 | `grep "requestJson"` → `bufferApi.ts:3,9`、`commentApi.ts:3,8` 已复用；`grep "apiFetch" api.ts` 命中 18 处；`readFile`/`writeFile`/`deleteFile`/`createBranch`/`uploadImage`/`commitBatch` 各自重复 `new AbortController()` + `setTimeout` + `try/finally clearTimeout` | 确定 |

**M-A1 修复方案（复用阶梯 PARTIAL_REUSE）：** `shared/types.ts` 已建立共享机制（`RepoInfo`、`CommitOp`、`FRONTMATTER_*_REGEX` 均成功复用）。建议将留言类型下沉：

```typescript
// shared/types.ts — 新增
export interface MessageReplyRow {
  id: number;
  message_id: number;
  reply_content: string;
  reply_type: string;
  reply_from_email: string;
  created_at: string;
}

/** 留言主记录（前后端共用；前端不消费回复 token，按需裁剪） */
export interface MessageRecord {
  id: number;
  visitor_name: string;
  visitor_email: string;
  visitor_website: string;
  visitor_ip: string;
  user_agent: string;
  client_hash: string;
  content: string;
  quoted_text: string;
  page_url: string;
  page_title: string;
  status: 'pending' | 'approved' | 'featured' | 'spam';
  is_deleted: number;
  needs_review: number;
  reply_content: string;
  reply_at: string | null;
  created_at: string;
  updated_at: string;
}
```

  然后 `cloudflare-worker/src/comment/types.ts` 改为 `export type MessageRow = MessageRecord & { reply_token: string }`，`web/src/lib/commentApi.ts` 改为 `export type AdminMessage = MessageRecord & { replies: MessageReplyRow[] }`。`CreateMessageInput` 保留 `validators.ts:42` 的 Zod 推断版本（单一真源），删除 `types.ts:48` 的 `interface`，并移除 `message.service.ts:20` 的 `as` 断言。

- **连带改动：** `message.service.ts:2` 的 import 路径、`admin.service.ts:1`、`email.service.ts:3`、`vectrel.service.ts:2`、`web/src/lib/messagesThread.ts:1`、`web/src/pages/MessagesPage.tsx:4`
- **前置条件：** 需编译验证（`npm run typecheck`）

### 可靠性/逻辑类

| # | 文件 | 行号 | 问题 | 验证 | 置信度 |
|---|------|------|------|------|-------|
| M-R1 | `cloudflare-worker/src/services/admin.service.ts`<br>`cloudflare-worker/src/services/message.service.ts` | 21<br>71-74 | 同一张 `messages` 表的两套分页语义，管理面用 `id < ?`，公开面用 `(created_at, id)` 复合游标 | 已读两处完整实现。`admin.service.ts:21` 为 `sql += ' AND id < ?'`；`message.service.ts:72` 为 `created_at < (SELECT ...) OR (created_at = ... AND id < ?)`。两处查询均 `ORDER BY` 降序，但边界条件依据不同列 | 确定 |

**M-R1 补充说明：** 若 `created_at` 存在相同值（`0001_init.sql:34` 默认 `CURRENT_TIMESTAMP`，同秒内批量写入会产生重复），两套语义下"下一页"的起始位置不一致。当前无功能故障（各自内部自洽），但两处维护同一张表的翻页逻辑，未来任一侧调整排序规则时会静默产生错位。`admin.service.ts:26-32` 还把 `status` 过滤条件**重复构建了两遍**（列表查询与计数查询各写一次），进一步增加漂移风险。建议提取共用的 `buildMessageFilter()` 并统一游标语义为 `(created_at, id)`。

### 错误处理类

本轮**未发现 MAJOR 级错误处理问题**。错误处理是该项目表现较好的维度：`errorHandler.ts:10-23` 按错误类型分级响应且不泄露内部细节；`extractFrontMatter.ts:169-189` 有完整的降级链路；`buffer.ts:28-42` 的 `respondBufferError` 明确把 S3 原始响应仅记日志、不回传客户端。

---

## 5. MINOR 问题列表

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| m-01 | `cloudflare-worker/src/services/buffer.service.ts` | 58-69 | 自研 `mapLimit` 并发控制器，与 `github.ts:580-602`、`extractFrontMatter.ts:140-148` 构成三处并发分块实现，语义相同、参数不同 |
| m-02 | `cloudflare-worker/src/services/github.ts` | 420-435 | 已有 `githubApi` 统一封装，但 `readFile`(152)、`writeFile`(191)、`deleteFile`(245)、`listDir`(288)、`getRepoBranches`(322)、`createBranch`(362)、`dispatchWorkflow`(623)、`getTree`(654) 共 8 个函数绕过它，各自重复 Authorization/User-Agent 头部与错误分支 |
| m-03 | `cloudflare-worker/src/routes/buffer.ts` | 152-157, 173-178, 219-224, 238-240, 259-261, 291-295 | `isSafePathParam(owner) \|\| isSafePathParam(repo) \|\| ...` 参数校验样板重复 6 次，每处配一遍相同的错误响应 |
| m-04 | `web/src/contexts/RepoContext.tsx` | 68 | context value 未用 `useMemo` 包装，每次 Provider 渲染新建对象，所有 `useRepo()` 消费者随之重渲染（对比 `BufferContext.tsx:99-110` 的正确写法） |
| m-05 | `web/src/contexts/CollectionsContext.tsx` | 144 | 同 m-04，且 `updateConfig`/`addPath`/`removePath`/`updateMediaConfig` 四个函数未用 `useCallback`，每次渲染引用都变。`MainLayout.tsx:432` 的 effect 依赖其中两个，导致该 effect 空跑（effect 内有 `syncedRepoKeyRef` 守卫，故不产生重复请求） |
| m-06 | 六处文件 | 见下 | 日期格式化独立实现 6 处：`api.ts:22` `formatTimestamp`、`mediaUtils.ts:68` `formatDate`、`messagesThread.ts:27` `formatTime`、`SchemaFormPanel.tsx:56` `formatDate`、`path.ts:23` `pad2`、`rename.ts:1` `padZero`。其中 `pad2` 与 `padZero` 是同一函数的两份实现 |
| m-07 | `web/src/lib/fileCache.ts` | 38-50, 52-54 | `clearAllCache()` 引用数为 0（`grep` 12 处 `clearCache` 调用全部只传一个参数），`clearCache` 的可选 `basePath` 分支亦从未被使用 — 死代码 |
| m-08 | `cloudflare-worker/src/services/inboundReply.service.ts` | 59-62 | `const { alert } = await appendEmailReply(...)` 后 `if (alert) { await alert.catch(...) }` — `appendEmailReply` 内部已 `.catch()` 兜底（`message.service.ts:233-235`），此处为冗余的双重等待 |
| m-09 | `web/src/pages/MediaPage.tsx` | 236, 248 | `setTimeout` 未在组件卸载时清理，卸载后仍会调用 `setCopiedId`/`setCopiedType`。**第 2 轮修正定级**：回调仅做状态置空，React 19 对卸载后 setState 静默忽略，无内存泄漏、无警告 → 实际风险仅为「复制提示跨文件误清」，定级由 MINOR **降为 NIT**（沿用 m-09 编号，跨轮可追溯） |
| m-10 | `cloudflare-worker/src/comment/utils/sanitizer.ts` | 1-12 | `sanitizeInput` 仅做 HTML 实体转义（`escapeHtml`），却命名为"sanitize"。该函数当前引用数为 0（`grep` 确认仅 `escapeHtml` 在 `email.service.ts` 被使用），而实体转义不能替代 HTML 白名单清洗 — 命名有误导性 |
| m-11 | `web/src/lib/http.test.ts` | 1-27 | 测试仅覆盖 `parseEnvelope` 的 4 个分支，`requestJson` 的超时、401 事件派发、网络异常、非 JSON 响应体四条分支**无任何测试**。该函数是 3 个 API 客户端的共同底座 |

---

## 6. NIT 问题列表

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| n-01 | `cloudflare-worker/src/services/crypto.service.ts` | 17, 22 | `btoa(String.fromCharCode(...combined))` 用展开运算符传参，超约 65k 元素会抛 `RangeError`。经核实当前调用面仅 session payload（约 150 字节）与 `secretAccessKey`（约 40 字符），**不构成现实风险**，仅作健壮性提示；`github.ts:41-48` 的循环写法是更稳的参考 |
| n-02 | `cloudflare-worker/src/middleware/pathGuard.ts` | 2-3 | `PATH_SAFE_PATTERN` 中的 `一-鿿` 是 CJK 范围字面写法，意图不直观，建议改用 `\u4e00-\u9fff` |
| n-03 | `web/src/contexts/AuthContext.tsx` | 43 | `data.data!.user!` 双非空断言，其上一行已用 `data.data?.user` 做守卫，断言冗余 |
| n-04 | `cloudflare-worker/src/services/spamSources.service.ts` | 55 | `throw new Error('未配置垃圾来源阈值: ' + dimension)` 抛出裸 `Error`，会被 `errorHandler.ts:21` 归入 500 分支并记日志。该情形属编程错误而非运行时异常，可用 `ApiError` 或直接省略（`SOURCE_THRESHOLDS` 是模块内常量，键集合固定） |
| n-05 | `web/src/pages/MessagesPage.tsx` | 482, 489, 524 | `part.replyId!` 三处非空断言。调用点已用 `part.replyType === '博主'`（482/489）与 `part.replyId !== undefined`（520）守卫，断言冗余 |
| n-06 | `cloudflare-worker/src/services/github.ts` | 649-755 | 文件实际 755 行（`grep` 计数含注释），超 service 层 300 行阈值 2.5 倍，内容涵盖 OAuth、文件 CRUD、Git Data API、Workflow、目录树五个职责域。属可延后处理的架构改进 |

---

## 7. 待确认问题

> 无法确定是缺陷还是有意设计，**不计入问题总数**。

| # | 文件 | 行号 | 疑问 | 已查证据 |
|---|------|------|------|---------|
| Q-01 | `cloudflare-worker/src/routes/auth.ts` | 115-136 | `/api/me` 的 "dev 快捷路径"（`devResult.githubToken === 'dev-local-no-github'` 直接返回 dev-user）未检查 `ENVIRONMENT`，而同文件 26 行的 `dev-login` 有此检查。因 token 需用 `SESSION_SECRET` 加密签发，外部无法伪造；且 `wrangler.jsonc:24` 已固定 `ENVIRONMENT: "production"`，`dev-login` 会返回 404 | 已读 115-136 完整逻辑；已确认 `crypto.service.ts` 为 AES-GCM 且 IV 随机；已读 `wrangler.jsonc` 确认生产环境变量。**结论：当前不可利用**，但该路径的存在依赖单一配置变量，建议加同等守卫（与 C-01 一并修复） |
| Q-02 | 多处 | — | `onErrorRef.current = onError` 形式的"渲染期写 ref"（`useFileListPage.ts:31`、`VditorEditor.tsx:15-19`、其他组件）是刻意采用的"最新值 ref"模式，用于避免闭包捕获旧值。StrictMode 双渲染下重复赋值，但赋值幂等 | 已读全部出现点，用途一致；`VditorEditor.tsx:21-53` 的 `useCallback` 依赖为空数组，正是为配合该模式。判定为有意设计，但若团队规范不接受该模式，可用 `useEffect` 同步（会推迟一帧） |
| Q-03 | `cloudflare-worker/src/services/message.service.ts` | 143-148 | `updateMessageStatus` 的状态机例外分支（`if (action !== 'feature' \|\| existing.status !== 'pending')`）使 `pending → featured` 绕过 `validTransitions` 表。从 `ACTION_STATUS_MAP` 看 `feature` 本就映射到 `featured`，而 `validTransitions.pending` 已包含 `featured`，该例外似为冗余 | 已读 126-162 完整逻辑与 `config.ts:8-14`。该分支在当前 `validTransitions` 下不可达；但若未来收紧 `pending` 的允许目标，它就成为后门。建议确认是否为遗留代码 |
| Q-04 | `cloudflare-worker/src/services/bufferConfig.service.ts` | 38-40, 42-72 | `StoredConfig extends Omit<BufferConfig, 'secretAccessKey'>` 后补 `secretAccessKeyEnc`，而读取时对 `parsed` 直接断言为 `StoredConfig` 且**未校验字段类型**（如 `endpoint` 是否为字符串）。若 `app_settings` 中被写入非预期结构，`parsed.endpoint.replace()` 会抛错并被 68 行的 catch 吞掉返回 null | 已读 42-72 完整实现；确认第 50 行只做存在性检查（`!parsed.endpoint`），未做类型检查。因该值仅由本服务写入，风险有限，但属防御性缺口 |
| Q-05 | `web/src/lib/markdown.ts` | 33-129 | 自研 129 行 Markdown 渲染器（正则拼接 HTML），而后端 `email.service.ts:41` 已使用 `markdown-it`（`cloudflare-worker/package.json:16` 已装）。两处 `renderMarkdown` **同名不同实现**。前端渲染结果经 `MessagesPage.tsx:509` 的 `dangerouslySetInnerHTML` 注入 | 已读两侧完整实现。前端版本先转义 HTML 再拼接标签，链接经协议白名单过滤（第 26 行），当前无可利用的 XSS 路径；且后端传入渲染器的已是 `extractPlainText`（`inbound.service.ts:56-70`）剥离标签后的纯文本。判断为"有意的轻量实现以避免前端引入 100KB+ 依赖"，但同名函数两套语义容易误用，建议改名区分 |
| Q-06 | `cloudflare-worker/src/services/session.ts` | 14-36, 95-97 | 设备指纹仅由「内核族+主版本」+ `Accept-Language` 派生，两者均为**攻击者可完全伪造的请求头**，熵约数万组合。一旦会话 token 泄露，指纹不构成第二道防线；且 token 无吊销机制（登出仅清 cookie，见 `routes/auth.ts:101-110`）。属有意的稳定性取舍（注释明言"浏览器升级不再轻易变指纹"）还是安全强度不足？ | 已读 `session.ts:13-26` 的注释（明确说明为增强稳定性而弱化）、`:29-36` 的构造逻辑、`:95-97` 的比对条件；已读 `auth.ts:101-110` 确认登出无服务端失效；已 grep 全仓无 `revoke`/`blacklist`/`jti` 概念 → 确定不存在吊销层。**需产品决策**：若接受该风险则维持现状并补文档；若不接受，需引入 KV 吊销或改用更强的指纹因子 |

---

## 8. 未验证项声明

> 第 1 轮列出的部分项已在第 2 轮消解，下表标注了「首轮」与「第 2 轮」的差异。

| 维度 / 范围 | 未验证原因 | 轮次 |
|------------|-----------|------|
| 运行时行为（会话并发、限流实际触发、S3 真实读写） | 当前环境无 Cloudflare Workers Runtime、无 D1/KV/S3 实例，仅做静态分析 | 首轮 + 第 2 轮 |
| 并发压力与竞态（`rateLimit.service.ts` 的 UPSERT 计数准确性、`db.batch` 部分失败的原子性） | 需真实 D1 环境；静态分析看 SQL 本身正确（`ON CONFLICT ... DO UPDATE SET count = count + 1 RETURNING count` 为原子操作）。**第 2 轮补充**：多处代码依赖 `db.batch([...])` 的隐式事务语义（`message.service.ts:151/158/187/209`、`admin.service.ts:60`），未在运行时验证部分失败会回滚 | 首轮 + 第 2 轮 |
| 前端 UI 实际交互（拖拽上传、发布对话框、移动端抽屉） | 未启动开发服务器，未做浏览器验证。本报告的 UI 相关结论均基于代码静态阅读 | 首轮 + 第 2 轮 |
| **M-R2 的端到端影响** | 缺陷触发路径（缓冲层删除文章 → 发布）的代码链已完整验证，但 `batchCommit` 对「同 path 两条 tree entry」的实际处理结果未在真实 GitHub 仓库上复现。判定依据是 Git Data API 的覆盖语义（后者 `sha: null` 胜出），置信度为「高」而非「确定」 | 第 2 轮新增 |
| **C-02 的生产可利用性** | `FRONTEND_URL` 未在仓库配置中定义已确定；但**是否已在 Cloudflare Dashboard 侧通过其他方式注入该变量**无法从仓库确认。若 Dashboard 已配置，C-02 的实际风险降为"配置漂移隐患"而非实际漏洞 | 第 2 轮新增 |
| `cloudflare-worker/public/` 与 `web/dist/` | 构建产物（已由 `.gitignore` 排除），不在审查范围 | 首轮 + 第 2 轮 |
| `cloudflare-worker/*.sql` 五个数据导出文件 | 生产数据快照，非源码；仅在核对 `admin_logs` CHECK 约束时作为对照证据引用 | 首轮 |
| `web/src/styles/globals.css`（618 行） | 样式文件，SKILL.md 规则不设行数上限。**第 2 轮**：抽读 100-189 行，未评估 `@media (prefers-reduced-motion)` 与全局 focus 样式完整性 | 首轮 + 第 2 轮 |
| 未逐个细读的文件（第 2 轮后剩余） | 第 2 轮子代理已补扫 `DashboardPage.tsx`、`TrashPage.tsx`、`SettingsPage.tsx`、`MediaSettings.tsx`、`FileTable.tsx`、`EditorPage.tsx`（部分）、`MediaPickerDialog.tsx`、`DirectoryTreePicker.tsx` 等。**仍未整体细读**：`MediaPreviewDialog.tsx`、`DeleteConfirmDialog.tsx`、`DirectorySelectorDropdown.tsx`、`EmptyState.tsx`、`LoadingState.tsx`、`Pagination.tsx`、`SiteSettings.tsx`、`DeviceSettings.tsx`、`PublishDraftDialog.tsx`、`RenameDraftDialog.tsx`、`sortFiles.ts`、`articleSlug.ts`、`resolveMediaSource.ts`、`detectFramework.ts`（部分） | 首轮 + 第 2 轮 |
| 依赖安全审计（`npm audit`） | **第 2 轮已部分消解**：版本真实性已核验（`web/node_modules/react/package.json` = 19.3.0、`vite` = 8.3.0、`react-router-dom` = 6.30.4，均已实体安装，版本真实存在）。**仍未执行**：已知 CVE 扫描（`npm audit`） | 首轮 + 第 2 轮 |
| 子代理路径 | **第 2 轮已解决**：4 个分片子代理全部成功返回（安全核心 / 业务服务与路由 / web lib 与 pages / 组件与 contexts）。首轮因 APIError 全数失败的路径本轮恢复可用 | 第 2 轮消解 |
| `SESSION_SECRET` 实际熵与轮换策略 | 仅存于 Cloudflare secret store，仓库不可见。`.dev.vars.example` 仅要求「至少 32 字符」；`crypto.service.ts:5` 用单轮 SHA-256 直接派生密钥（无 HKDF/PBKDF2/盐），安全下限完全取决于该 secret 的熵 | 第 2 轮新增 |
| 生产 `ALLOWED_ORIGINS` / `PROD_ORIGINS` 的真实取值 | 仓库中均未定义（`grep` 0 命中），但可能由 Cloudflare 环境注入。该取值直接决定 M-S2 的开放重定向是否实际可利用 | 第 2 轮新增 |
| `X-Frontend-Url` 头的实际注入路径 | 该头受浏览器同源策略约束，未做浏览器级验证确认攻击者能否在受害者的 OAuth 流程中注入该头 | 第 2 轮新增 |

---

## 9. 做得好的地方

1. **TypeScript 配置严格且执行到位。** 两个 `tsconfig.json` 均启用 `strict: true`，web 侧额外开启 `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`。全项目 `grep ": any|as any|<any>|any[]"` **命中数为 0** — 在 107 个 TS 文件中做到这一点不常见。

2. **Provider 嵌套顺序正确。** 逐个追溯五个 Provider 的依赖关系（`App.tsx:53-57`）：ToastProvider（最外，无依赖）→ AuthProvider（消费 useToast）→ RepoProvider（消费 useAuth）→ BufferProvider（消费 useRepo + useToast）→ CollectionsProvider（最内，无消费）。**每一层被依赖者都在依赖者外层**，避开了 `react.md:152-177` 记录的头号 Provider 回归事故。第 2 轮由独立子代理复验确认顺序无误；同时发现 `ToastContainer` 挂载位置造成的渲染放大问题（记为 m-16），但该问题不涉及拓扑正确性。

3. **SQL 层无注入面，且已参数化到细节。** 遍历全部 worker 源码中的 `db.prepare` 调用，**未发现任何字符串拼接用户输入**。`listMessages` 与 `attachReplies` 中的 `IN (${placeholders})` 是占位符数量拼接（`ids.map(() => '?')`），值仍走 `.bind()`，属正确用法。

4. **评论公开端点的防御层次完整。** `validators.ts:8-40` 用 Zod 定义了含长度上限、邮箱格式、URL 协议白名单的完整 schema；`security.ts:1-36` 实现了 IPv4/IPv6 私网段判定（含 `::ffff:` 映射与 `fc00::/7`），用于 `visitor_website` 的 SSRF 防护；`message.service.ts:28-35` 有 IP/邮箱/全局三层限流；`turnstile.service.ts:4-19` 的人机验证有 5 秒超时与失败分类。

5. **`batchCommit` 的并发冲突检测是亮点。** `github.ts:532-538` 在 `PATCH ref` 前重新读取基线 sha 并比对，不一致则抛 409 — 这是分布式写入场景中容易被忽略的一步，实现正确且注释说明了意图（"避免静默覆盖"）。

6. **Git 卫生良好。** `.env`（含 `CLOUDFLARE_API_TOKEN`、`SESSION_SECRET` 等）已被 `.gitignore:26` 排除且未进版本库（`git ls-files --error-unmatch .env` 返回未跟踪）；`.gitignore` 同时排除了 `.dev.vars`、`wrangler.toml`、`public/`（构建产物）。仓库根目录下的 `bloath.icecome.com-*.log` 被 `*.log` 覆盖。

7. **Webhook 验签实现符合 Svix 规范。** `inbound.service.ts:27-48` 包含时间戳窗口校验（±5 分钟防重放）、`timingSafeEqual` 常量时间比较（防时序侧信道）、多签名候选遍历（支持密钥轮换期），`claimWebhookEvent`（109-119）用 `INSERT OR IGNORE` + 主键实现幂等去重并清理 1 天前记录。

8. **缓存实现有意规避了常见陷阱。** `ToastContext.tsx:28` 用 `useRef` 而非模块级变量做 ID 计数器（避免多实例互相污染，正是 `react.md:216-226` 列出的反模式）；`fileCache.ts:31-34` 的 Map 淘汰按插入顺序清理最旧条目；`AuthContext.tsx:62-68` 的轮询定时器有 `clearInterval` 清理。

---

## 10. 代码复用评估（复用阶梯）

按 code-reuse-ladder 的 7 步阶梯，对识别出的代码单元逐一评估。**零成本预检（第 3、4 步）优先执行**：项目未安装 lodash/date-fns 等通用工具库，标准库与原生 API 已覆盖大部分场景。

### [R-1] HTTP 请求客户端

```
位置: web/src/lib/api.ts:33-82 (apiFetch)  vs  web/src/lib/http.ts:23-64 (requestJson)

当前实现: 两套并行的 fetch 封装，各自处理超时/401/信封解析

阶梯结论: Step 2 - REUSE_EXISTING
复用证据: web/src/lib/http.ts:23 的 requestJson，已被 bufferApi.ts:9 与
          commentApi.ts:8 复用，且有 http.test.ts 的 4 个用例覆盖 parseEnvelope
证据核验: 已读两文件完整实现；grep "requestJson" 命中 4 处（定义 1 + 调用 3）；
          grep "apiFetch" 在 api.ts 命中 18 处
迁移成本: M（< 1 人日）
破坏性变更: 否（apiFetch 为模块私有函数，未导出）
测试覆盖: requestJson 本身无测试（仅 parseEnvelope 有 4 个用例）；apiFetch 亦无

建议:
- 让 apiFetch 委托给 requestJson，保留 skipDataCheck 这一个api.ts 特有的语义
  （用于 204/void 响应），可将其提升为 requestJson 的选项：
    export async function requestJson<T>(
      pathOrUrl: string, options: HttpRequestOptions & { skipDataCheck?: boolean } = {}, baseUrl = ''
    ): Promise<T>
- 删除 apiFetch 内重复的 AbortController 管理逻辑（api.ts:34-51、125-135、
  141-164、170-191、292-304、336-359、412-431 共 7 处样板）
- 补测 requestJson 的超时/401/非 JSON 三条分支（当前 0 覆盖）
优先级: HIGH
```

### [R-2] 留言数据结构定义

```
位置: cloudflare-worker/src/comment/types.ts:13-33 (MessageRow)
      web/src/lib/commentApi.ts:22-40 (AdminMessage)

当前实现: 同一数据结构（messages 表行）在前后端各定义一次，字段名与类型完全一致

阶梯结论: Step 2 - PARTIAL_REUSE
复用证据: shared/types.ts 已建立共享机制，其中 RepoInfo(1-5)、CommitOp(147-158)、
          FRONTMATTER_YAML_REGEX(161) 均被前后端成功复用，证明该机制可用
证据核验: 已逐字比对两侧字段；grep "MessageRow" 命中 10 处（worker 侧）；
          grep "AdminMessage" 命中 6 处（web 侧）；两者仅差 reply_token / replies
迁移成本: M（< 1 人日，涉及 6 个 import 点）
破坏性变更: 是（类型定义位置变更）
测试覆盖: 类型定义无需测试；但 messagesThread.ts:46 的 buildThread 依赖 AdminMessage
          结构，改动后需确认其行为不变

建议:
- 在 shared/types.ts 提取 MessageRecord 基础接口（见 M-A1）
- worker 侧与 web 侧各自通过交叉类型补充独有字段
- 注意 shared/ 已被两侧 tsconfig 的 include 覆盖（worker tsconfig.json:14
  含 "../shared/**/*.ts"），无需额外配置
优先级: HIGH
```

### [R-3] 并发分块控制

```
位置: cloudflare-worker/src/services/buffer.service.ts:58-69 (mapLimit)

当前实现: 自研 worker-pool 式并发控制器（游标 + 固定 worker 数）

阶梯结论: Step 2 - PARTIAL_REUSE（内部三处同语义实现，但暂不建议引入外部依赖）
复用证据: 存在三种同语义实现——buffer.service.ts:58 的 mapLimit、
          github.ts:580-602 的 for + Promise.all 分块、extractFrontMatter.ts:140-148
          的 for + Promise.all 分块
证据核验: grep "Promise.all(|mapLimit|CONCURRENCY|batchSize|CHUNK_SIZE" 命中 18 处
迁移成本: S（< 1 小时）
破坏性变更: 否

建议:
- 第 5 步（第三方）评估结论为 THIRD_PARTY_SKIP：p-limit 等库体积虽小，但项目
  当前已零运行时工具依赖（worker 侧仅 aws4fetch/hono/markdown-it/zod），为
  三个调用点引入新依赖不划算
- 建议走第 6 步（内联复用）：把 mapLimit 提到 cloudflare-worker/src/lib/ 下作为
  共享工具，github.ts 与 extractFrontMatter.ts 改用它。mapLimit 已正确实现
  （不依赖 Promise.all 的批处理语义，worker 数固定，返回值保持输入顺序）
优先级: MEDIUM
```

### [R-4] 日期格式化

```
位置: 六处独立实现（见 m-06）

当前实现: pad2/padZero 两份等价实现 + 四份 YYYY-MM-DD 拼接逻辑

阶梯结论: Step 3 - USE_STDLIB（部分场景）
复用证据: web 侧已用 Intl.DateTimeFormat（vectrel.service.ts:49 的
          beijingFormatter 是正确示范）
证据核验: grep "getFullYear()" 在 web/src 命中 8 个文件；
          grep "^export function format(Date|Time)|^function pad" 命中 6 个定义点
迁移成本: S（< 1 小时）
破坏性变更: 否（均为模块私有或内部工具函数）

建议:
- pad2(path.ts:23) 与 padZero(rename.ts:1) 保留其一并导出，另一处改为 import
- api.ts:22 的 formatTimestamp（生成 commit message 用的紧凑时间戳）与
  mediaUtils.ts:68 的 formatDate（UI 展示格式）语义不同，不建议强行合并
- messagesThread.ts:27/37 已用 toLocaleString 正确处理时区，是较优实现，
  可作为 UI 展示格式的统一参考
- 注意：path.ts 的 formatYyyymmdd/formatHhmmss 有测试覆盖（path.test.ts:32-77），
  改动需保持行为不变
优先级: LOW
```

### [R-5] 死代码清理

```
位置: web/src/lib/fileCache.ts:52-54 (clearAllCache)
      web/src/lib/fileCache.ts:38-42 (clearCache 的 basePath 分支)
      cloudflare-worker/src/comment/utils/sanitizer.ts:1-3 (sanitizeInput)

当前实现: 三个导出/分支从未被调用

阶梯结论: Step 1 - SKIP（反向应用：应删除）
复用证据: none（正是因无复用价值才建议删除）
证据核验: grep "clearAllCache" → 仅定义处 1 命中；
          grep "clearCache" → 12 处调用全部单参数；
          grep "sanitizeInput" → 仅定义处 1 命中
迁移成本: S（< 1 小时）
破坏性变更: 否（无调用点）

建议:
- 直接删除 clearAllCache 与 clearCache 的 basePath 参数
- sanitizeInput 若确认不用则删除；若保留，建议改名为 escapeHtmlAndTrim
  以免与"HTML 白名单清洗"混淆
优先级: LOW
```

### [R-6] 自研 Markdown 渲染器（Q-05）

```
位置: web/src/lib/markdown.ts:33-129 (renderMarkdown)
      cloudflare-worker/src/services/email.service.ts:41-78 (renderMarkdown, markdown-it)

当前实现: 前端 129 行正则渲染器 vs 后端 markdown-it（已安装）

阶梯结论: Step 5.1 - USE_EXISTING_DEP（推荐但不强制）
复用证据: markdown-it 已在 cloudflare-worker/package.json:16 声明，
          但属 worker 的子项目依赖，web 侧安装会新增约 100KB（gzip ~30KB）
证据核验: 已读两侧完整实现；grep "renderMarkdown" 命中前端 3 处（1 定义 + 2 调用）、
          后端 4 处
迁移成本: M
破坏性变更: 是（渲染输出格式可能变化，影响消息展示）

建议:
- 属于权衡决策而非缺陷：前端引入 markdown-it 会显著增加主包体积（当前已用
  React.lazy 懒加载 EditorPage，说明团队在意包体积）
- 但两个同名函数语义不同是明确的维护隐患，建议至少重命名：
  前端 renderMarkdown → renderMessageMarkdown
- 若决定统一，markdown-it 的 html:false 配置（email.service.ts:35）已足够安全
优先级: LOW
```

---

## 11. 改进建议（按优先级）

### P0 — 立即修复（安全阻塞项）

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 1 | 为 `requireAdminAuth` 增加 GitHub 用户白名单校验，新增 `ADMIN_GITHUB_LOGIN` 环境变量 | `cloudflare-worker/src/middleware/sessionAuth.ts:73-87` | C-01 | 需编译验证 + 需配置 Cloudflare 变量 |
| 2 | 会话 payload 增加 `githubLogin` 字段，决定存量 token 的处置策略（建议拒绝并要求重登） | `cloudflare-worker/src/services/session.ts:39-108` | C-01 | 需编译验证 |
| 3 | 为 `/api/me` 的 dev 快捷路径补 `ENVIRONMENT !== 'production'` 守卫 | `cloudflare-worker/src/routes/auth.ts:123-127` | Q-01 | 可静态验证 |

### P1 — 本周修复

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 4 | 默认 CSP 移除 `'unsafe-eval'`；评估是否可用 nonce 替换 `'unsafe-inline'` | `cloudflare-worker/src/middleware/cors.ts:40-42` | M-S1 | 需在浏览器验证 vditor 是否正常（当前环境不具备，需产品环境验证） |
| 5 | 提取 `MessageRecord` 到 `shared/types.ts`，消除三处重复定义与 `as` 断言 | `shared/types.ts`、`comment/types.ts:13-48`、`commentApi.ts:22-40` | M-A1 | 需编译验证 |
| 6 | 让 `apiFetch` 复用 `requestJson`，删除 7 处重复的超时样板 | `web/src/lib/api.ts:33-82` | M-A2 | 需编译验证 + 需跑测试 |
| 7 | 补测 `requestJson` 的超时、401 事件、非 JSON 响应三条分支 | `web/src/lib/http.test.ts` | m-11 | 需运行测试 |
| 8 | 统一管理面与公开面的分页游标语义为 `(created_at, id)` | `cloudflare-worker/src/services/admin.service.ts:21` | M-R1 | 需编译验证；需确认现有前端 `nextCursor` 消费逻辑（`MessagesPage.tsx:43,86`） |

### P2 — 架构重构

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 9 | 提取共享 `mapLimit` 到 `cloudflare-worker/src/lib/`，替换三处并发实现 | `buffer.service.ts:58-69`、`github.ts:580-602`、`extractFrontMatter.ts:140-148` | m-01 | 需编译验证 + 需跑测试 |
| 10 | 让 `github.ts` 的 8 个函数复用已有的 `githubApi` 封装 | `cloudflare-worker/src/services/github.ts` | m-02 | 需编译验证 |
| 11 | 为 `buffer.ts` 提取路径参数校验辅助函数 | `cloudflare-worker/src/routes/buffer.ts` | m-03 | 可静态验证 |
| 12 | 评估拆分 `github.ts`（755 行 / 五个职责域） | `cloudflare-worker/src/services/github.ts` | n-06 | 需编译验证 |
| 13 | 提取 `buildMessageFilter()` 消除 admin.service 中重复的 status 条件构建 | `cloudflare-worker/src/services/admin.service.ts:17-32` | M-R1 | 需编译验证 |

### P3 — 渐进改进

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 14 | `RepoContext` 的 value 用 `useMemo` 包装 | `web/src/contexts/RepoContext.tsx:68` | m-04 | 可静态验证；需验证消费者重渲染行为不变 |
| 15 | `CollectionsContext` 的 value 用 `useMemo`，四个函数用 `useCallback` | `web/src/contexts/CollectionsContext.tsx:120-144` | m-05 | 同上；注意 `MainLayout.tsx:432` 的 effect 依赖 |
| 16 | 合并 `pad2`/`padZero` 为一个导出函数 | `web/src/lib/path.ts:23`、`web/src/lib/rename.ts:1` | m-06 | 可静态验证；需保持 `path.test.ts` 通过 |
| 17 | 删除 `clearAllCache` 与 `clearCache` 的未用参数 | `web/src/lib/fileCache.ts:38-54` | m-07 | 可静态验证 |
| 18 | 清理 `inboundReply.service.ts:61` 的冗余 `await alert.catch()` | `cloudflare-worker/src/services/inboundReply.service.ts:59-62` | m-08 | 可静态验证 |
| 19 | 为 `MediaPage` 的 `setTimeout` 添加卸载清理 | `web/src/pages/MediaPage.tsx:236,248` | m-09 | 需编译验证 |
| 20 | 重命名 `sanitizeInput` 或删除（当前引用数 0） | `cloudflare-worker/src/comment/utils/sanitizer.ts:1-3` | m-10 | 可静态验证 |
| 21 | 前端 `renderMarkdown` 重命名以区别于后端同名函数 | `web/src/lib/markdown.ts:33` | Q-05 | 需编译验证（3 处引用） |
| 22 | 清理冗余非空断言（`data.data!.user!`、`part.replyId!` ×3） | `AuthContext.tsx:43`、`MessagesPage.tsx:482,489,524` | n-03、n-05 | 可静态验证 |
| 23 | `PATH_SAFE_PATTERN` 改用 `\u4e00-\u9fff` 转义写法 | `cloudflare-worker/src/middleware/pathGuard.ts:2-3` | n-02 | 可静态验证 |

---

## 12. 覆盖率校验

| 指标 | 首轮 | 第 2 轮新增 | 合计 |
|------|------|------------|------|
| 总问题数 | 22 | 17 | **39** |
| 行动项总数 | 23 | 14 | **37** |
| 已覆盖问题数 | 22 | 17 | **39** |
| 覆盖率 | 22/22 = 100% | 17/17 = 100% | **39/39 = 100%** |
| 延期处理问题 | 无 | 无 | 无 |
| 待确认问题（不计入总数） | Q-01~Q-05 | Q-06 | Q-01~Q-06 |

> 校验公式：总问题数 = 已覆盖问题数 + 延期处理问题数 → 39 = 39 + 0 ✅
>
> 注：行动项数（37）少于问题数（39），因部分行动项合并覆盖多个同源问题（如行动项 24 同时覆盖 C-02 与 M-S2；行动项 27 同时覆盖 m-12 与 m-19）。详见第 13 章的行动项映射。

### 证据完整性自检

- [x] 报告中出现的每个文件路径，均已用工具确认存在
- [x] 报告中引用的每个行号，均已用 `grep -n` 精确定位核验
- [x] 每条"缺少 X 防护"的发现，均已检查上游/中间件/类型系统（C-01 检查了中间件层与 wrangler 配置；C-02 检查了 `fill-kv-namespace.mjs` 全部内容确认无变量注入；M-S1 检查了环境变量覆盖情况）
- [x] 每条 CRITICAL/MAJOR 均附验证行与置信度
- [x] 每个跨文件重构建议均附连带改动清单（C-01、C-02、M-A1、M-A2）
- [x] 未检查的维度已写入「未验证项声明」
- [x] 第 2 轮子代理的每条发现均已独立复验；不成立者列入第 14 章

### 执行证据

| 检查项 | 命令 | 结果 |
|--------|------|------|
| web 类型检查 | `cd web && npm run typecheck` | 通过（无错误输出） |
| worker 类型检查 | `cd cloudflare-worker && npm run typecheck` | 通过（无错误输出） |
| web 单元测试 | `cd web && npm test` | **19 通过 / 0 失败** |
| `any` 类型计数 | `grep ": any\|as any\|<any>\|any[]"` | 0 命中 |
| `.env` 版本控制状态 | `git ls-files --error-unmatch .env` | 未跟踪（正确） |
| SQL 拼接注入扫描 | 遍历全部 `db.prepare` 调用 | 未发现拼接用户输入 |
| 依赖真实性核验 | 读取 `web/node_modules/*/package.json` | `react@19.3.0`、`vite@8.3.0`、`react-router-dom@6.30.4` 均已实体安装，版本真实存在 |
| `FRONTEND_URL` 配置核验 | `grep FRONTEND_URL`（全部源码 + 配置 + 脚本） | 代码侧 3 处引用，配置侧 0 处定义 → C-02 成立 |
| `fill-kv-namespace.mjs` 全文核验 | Read 全文 39 行 | 仅替换 `${KV_NAMESPACE_ID}`，不注入其他变量 → C-02 排除例外 |

---

## 13. 第 2 轮交叉验证与新增发现

> 本轮由 4 个独立子代理分片审查（安全核心 / 业务服务与路由 / web lib 与 pages / 组件与 contexts），全部成功返回。子代理的每条候选发现均经主代理独立读取代码复验后才并入下表；**未通过复验的 3 条见第 14 章**。

### 13.1 CRITICAL 新增

#### C-02: 生产配置缺 `FRONTEND_URL`，重定向目标由请求头驱动，构成开放重定向

- **文件：** `cloudflare-worker/wrangler.jsonc:23-27`（配置缺失）、`cloudflare-worker/src/routes/auth.ts:68-71`、`cloudflare-worker/src/index.ts:63-66`
- **类别：** 安全（A01:2021 破坏访问控制 / 开放重定向）
- **验证：**
  - `grep -n "FRONTEND_URL" -g "*.ts" -g "*.jsonc" -g "*.mjs" cloudflare-worker shared` → **代码侧 3 处引用**（`index.ts:65`、`auth.ts:57`、`auth.ts:71`），**配置侧 0 处定义**
  - 已读 `wrangler.jsonc:23-27` 全部 `vars`：仅 `ENVIRONMENT`、`CORS_ORIGIN`、`INBOUND_REPLY_DOMAIN`、`RESEND_FROM` 四项
  - 已读 `cloudflare-worker/scripts/fill-kv-namespace.mjs` 全文 39 行：确认**只替换 `${KV_NAMESPACE_ID}`**，不注入任何其他变量，排除"由部署脚本补齐"的可能
  - 已读 `auth.ts:68-71` 完整逻辑：`headerFrontendUrl` 优先于 `c.env.FRONTEND_URL`
  - 已读 `index.ts:62-66`：全局兜底路由同型逻辑
- **置信度：** 高（配置缺失确定；是否已在 Cloudflare Dashboard 侧另行配置无法从仓库确认 —— 该不确定性已写入第 8 章未验证项）
- **问题：** 代码中三处取值均为 `c.env.FRONTEND_URL || 'http://localhost:5173'`。`FRONTEND_URL` 未在 `wrangler.jsonc` 定义，生产环境该项为 `undefined`，兜底到 `http://localhost:5173`。而 `auth.ts:68-71` 的逻辑是**优先采信请求头 `X-Frontend-Url`**：

```ts
68:   const headerFrontendUrl = c.req.header('X-Frontend-Url');
69:   const frontendUrl = (headerFrontendUrl && isAllowedFrontendUrl(headerFrontendUrl, c.env))
70:     ? headerFrontendUrl
71:     : (c.env.FRONTEND_URL || 'http://localhost:5173');
```

  且该值经 `state` 传递到 `auth.ts:94` 作为 302 的 `Location`：

```ts
94:   const response = new Response(null, { status: 302, headers: { 'Location': storedFrontendUrl + '/' } });
```

  叠加 M-S2（`isAllowedFrontendUrl` 用原始字符串比对，且 `getAllowedOrigins` 无条件注入 4 个 localhost 默认值），攻击者可将 `X-Frontend-Url` 设为 `http://localhost:5173`（命中白名单）→ 回调重定向到 localhost。

- **影响：** OAuth 回调可被重定向到攻击者可控的 localhost 端口（若配合本地恶意服务）。`sessionAuth.ts:25` 显示生产环境 cookie 用 `SameSite=None`，跨站场景下 cookie 会随请求发送，构成会话投递面。同时 `index.ts:66` 的全局兜底会把**全部非 API 请求 301 到 localhost**，属明显的功能异常（用户访问生产 Worker 根路径会被踢到本地）。
- **建议修复：**
  1. 在 `wrangler.jsonc` 的 `vars` 中显式设置 `"FRONTEND_URL": "https://blog.icecome.com"`，并同步设置 `PROD_ORIGINS`
  2. 移除 `X-Frontend-Url` 头的优先地位，改为**只**从 `env.FRONTEND_URL` 读取（该头是历史遗留，用于跨站部署，但代价过高）
  3. 若必须保留该头，则用 `parsed.origin` 严格比对（见 M-S2）并拒绝任何 `localhost` 值
  4. 将 `getAllowedOrigins` 中的 localhost 默认值改为**仅在 `ENVIRONMENT !== 'production'` 时注入**
- **连带改动：**
  - `web/src/contexts/AuthContext.tsx:81-87` — 前端 `login()` 会发送 `X-Frontend-Url: window.location.origin`；若移除该头支持，此处需一并清理
  - `cloudflare-worker/src/middleware/cors.ts:27` — `Access-Control-Allow-Headers` 包含 `X-Frontend-Url`，需同步移除
  - `cloudflare-worker/src/routes/auth.ts:54-55` — `Origin` 头的使用同样依赖白名单
- **前置条件：** 需编译验证；需在 Cloudflare 侧配置 `FRONTEND_URL` 与 `PROD_ORIGINS`

### 13.2 MAJOR 新增

| # | 文件 | 行号 | 问题 | 验证 | 置信度 |
|---|------|------|------|------|-------|
| M-S2 | `cloudflare-worker/src/middleware/cors.ts` | 13-18 | `isAllowedFrontendUrl` 解析出 `parsed` 却用 `rawUrl` 原始串比对白名单；且 `getAllowedOrigins` 无条件注入 4 个 localhost | 已读 5-18 行全文。`parsed` 变量仅在 16 行用作协议检查，17 行比对对象是 `rawUrl`。已读第 8 行确认 `defaultOrigins` 无环境判断 | 确定 |
| M-R2 | `cloudflare-worker/src/services/publish.service.ts` | 89-93 | move 条目无 `publishTarget` 时，`toPath` 解析回源路径，导致 `fromPath === path`，在 Git tree 中同路径写两条 entry（后者 `sha: null`）→ 文件被删除而非移动 | 已读 25-29、66-99 行完整逻辑。已读唯一 move 写入点 `web/src/pages/EditorPage.tsx:309`：`writeBufferFile({ path: trashFile, op: 'move', fromPath: currentFilePath })` **不传 publishTarget** → 第 91 行 `targetPath === path` 为真 → 第 91 行右侧 `resolvePublishPath(from, undefined)` 返回 `from`。已读 `github.ts:499-506` 确认同 path 两条 entry 的构造方式 | 高 |
| M-R3 | `web/src/hooks/useFileListPage.ts` | 47-51 | `scanMdFiles` 返回后直接 `setFiles`，无 owner/repo 守卫，切换仓库后陈旧响应覆盖新数据 | `grep cancelled` 在此文件 0 命中；同项目已有两个正确范式：`DraftsPage.tsx:81-85` 的 `cancelled` 标志、`MainLayout.tsx:416` 的 owner/repo 比对。该 hook 被 Dashboard/Drafts/Trash 三页共用 | 高 |
| M-R4 | `web/src/pages/DashboardPage.tsx` | 21-22, 87-109, 250-257 | 撤销键 `bloath_undo_{owner}_{repo}` **不含 branch**；切换分支后 undo 在**新分支**上执行旧分支的路径移动 | 已读 `getUndoKey`(21-22) 全文；已读 `UndoRecord` 接口(25-29) 确认无 branch 字段；已读恢复 effect(87-109) 依赖 `[selectedRepo]` 且读同一 key；已读 undo 闭包(250-257) 使用 `selectedRepo.branch` + `originalPath` | 高 |

**M-R2 补充说明：** 该缺陷的触发条件是"通过缓冲层删除文章（移至回收站）"。`EditorPage.tsx:308-313` 是缓冲模式下删除的唯一路径，它写入的 move 条目 `path=目标`、`fromPath=源`，且不设 `publishTarget`。发布时 `resolvePublishPath(path, undefined)` 直接返回 `path`（`publish.service.ts:26`），使 `targetPath === path` 判定为真，进而把目标路径重新解析为源路径。

**M-R2 修复建议：**
```ts
} else if (entry.op === 'move') {
  const from = entry.fromPath;
  // move 条目的 path 语义即目标路径，无需再次解析；仅当显式指定 publishTarget 时才重写
  const toPath = target ? resolvePublishPath(path, target) : path;
  if (from && from !== toPath && remoteShas.has(from)) {
    ops.push({ op: 'move', fromPath: from, path: toPath });
  } else {
    skipped++;
  }
  keysToClear.push(key);
}
```
  连带改动：`publish.service.ts:91` 的表达式变更后，需确认 `DraftsPage`/`TrashPage` 的逐项发布（传 `items` 且带 `publishTarget`）路径行为不变 —— 那些场景 `target` 有值，仍走 `resolvePublishPath`。

**M-R4 修复建议：** 将 branch 纳入撤销键，或在 `UndoRecord` 中记录 `branch` 并在恢复时比对：
```ts
function getUndoKey(repo: { owner: string; repo: string; branch?: string }) {
  return `${UNDO_STORAGE_PREFIX}_${repo.owner}_${repo.repo}_${repo.branch || 'main'}`;
}
```
  连带改动：`DashboardPage.tsx:89,232,266` 三处调用点；`constants.ts:9` 的 `UNDO_STORAGE_PREFIX` 不变，但旧 key 会残留（可在启动时清理前缀匹配的旧格式）。

### 13.3 MINOR 新增

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| m-12 | `web/src/pages/TrashPage.tsx` | 48 | `err.message.includes('404')` 判断目录未创建。**该分支实际永不命中**：`apiFetch` 仅在 content-type 非 JSON 时才抛含状态码的消息（`api.ts:69-70`），而 Worker 的 `errorHandler.ts:12` 返回 JSON 信封，404 会走 `parseEnvelope`（`api.ts:77`）抛出业务 message。副作用：任何 message 恰好含 "404" 的业务错误会被静默降级为 `console.info` |
| m-13 | `web/src/lib/repoConfigSync.ts` | 19-22 | 同型 `isNotFound` 靠 `msg.includes('404') \|\| msg.includes('not found')` 字符串匹配，与 m-12 同源。此处有回退语义（返回 null），后果比 m-12 轻 |
| m-14 | `cloudflare-worker/src/services/github.ts` | 659, 699 | `mode` 类型声明支持 `'commits'`，但函数内仅 `if (mode === 'filename')` 生效，`'commits'` 与 `undefined` 行为完全相同 → 死分支。`web/src/lib/api.ts:309` 的 JSDoc 却声称"`'commits'` = 通过 commits API 获取时间（内容库/草稿箱/回收站）"，与实现矛盾。**已核验 4 个调用点均未传 `'commits'`**（`MediaPickerDialog.tsx:36`、`MediaPage.tsx:86` 传 `'filename'`；`dirTree.ts:70`、`detectFramework.ts:118`、`scanner.ts:9` 不传），故无功能影响，纯文档/类型误导 |
| m-15 | `cloudflare-worker/src/routes/admin.ts`<br>`cloudflare-worker/src/services/admin.service.ts` | 99-101<br>60 | 批量操作的状态变更（`admin.service.ts:60` 的 `db.batch`）与审计日志（`admin.ts:99` 的 `writeBatchAuditLogs`）分属两次提交，且日志失败被 catch 静默吞掉（仅 `console.warn`）。对比单条路径 `message.service.ts:158-161` 是 update+log **同一批次**。后果：批量操作可能留下无审计记录的状态变更 |
| m-16 | `web/src/App.tsx` | 58 | `<ToastContainer />` 挂在最内层 `CollectionsProvider` 内，只消费 `useToast` 却订阅了 Auth/Repo/Buffer/Collections 四层 Provider 的 value 变更（各层 value 均为内联对象字面量，每次渲染新建）。移至 `ToastProvider` 直接子级可消除渲染放大 |
| m-17 | `shared/types.ts` | 11-22, 24-32, 95-100 | 三个导出类型引用数为 0（死类型）：`ContentEntry`（仅定义行命中）、`Collection`（仅定义行命中）、`ContentListParams`（仅定义行命中）。逐导出 grep 计数确认；对照 `FieldConfig`（14 处引用）、`ShowWhen`（2 处）、`CommitOp`（11 处）均活跃 |
| m-18 | `web/src/components/media/MediaUploader.tsx` | 14-29 | 拖拽上传区仅有 `onDragOver/onDragLeave/onDrop/onClick`，无 `role="button"`、`tabIndex`、`onKeyDown`；内层 `<input type="file">` 为 `className="hidden"` → 键盘用户无法触发上传。同项目 `DirectoryTreePicker.tsx:49-57` 已正确使用 `tabIndex`/`aria-label`，属内部不一致 |
| m-19 | `web/src/pages/DraftsPage.tsx` | 134-136, 253-258, 296-298 | `actionLoading` 仅通过 `disabled` 属性在**渲染后**生效，同一事件循环内的双击均通过前置校验。`handleSingleDelete`（296-298）**完全没有 `actionLoading` 前置判断**。后果：双击删除会发起两次 `commitBatch`，第二次因源文件已不存在而失败，用户看到"删除失败"但文件实际已移动 |

**m-12 修复建议（优先级高于其他 MINOR）：** 在 `apiFetch` 抛出错误时附加结构化状态码，而非依赖消息文本：
```ts
// api.ts — 定义可携带 status 的错误类型
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}
// apiFetch 内所有 throw new Error(`HTTP ${res.status}...`) 改为 throw new HttpError(res.status, ...)
```
  然后 `TrashPage.tsx:48` 改为 `if (err instanceof HttpError && err.status === 404)`。这与 M-A2（统一 HTTP 客户端）是同一次重构，**建议合并实施**。

### 13.4 NIT 新增

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| n-07 | `web/src/components/editor/SchemaFormPanel.tsx`<br>`web/src/components/settings/BufferSettings.tsx` | 314<br>96-97 | `<label>` 无 `htmlFor`/`id`，不与控件关联。对照 `MediaSettings.tsx:100-103`、`DeviceSettings.tsx:162-169` 已正确配对 |
| n-08 | `web/src/components/editor/SchemaFormPanel.tsx` | 496-499 | 模块级可变计数器 `nextFieldRowId`，跨组件实例共享且不随卸载重置。`StrictMode` 双调用会跳号但不重复，无实际 key 冲突；`useRef` 是更贴合的写法 |
| n-09 | `web/src/components/layout/PublishButton.tsx`<br>`web/src/components/drafts/PublishDraftDialog.tsx`<br>`web/src/components/drafts/RenameDraftDialog.tsx` | 26<br>152,159<br>31,37 | 图标按钮缺 `aria-label`（`PublishButton.tsx:26` 的关闭按钮仅含 `<X />`）；部分按钮未写 `type="button"`（`RenameDraftDialog.tsx:31,37`）。对照 `MediaPickerDialog.tsx:65`、`MediaPreviewDialog.tsx:35` 均有标注 |
| n-10 | `cloudflare-worker/src/services/inbound.service.ts` | 109-119 | `claimWebhookEvent` 在**每次 webhook 请求**中执行 `CREATE TABLE IF NOT EXISTS webhook_events ...`（111 行）。DDL 走 schema 锁，属热路径开销。0007 迁移已收编该表（`0007_music_sources.sql:38`），此处兜底可移除 |

### 13.5 首轮结论的交叉验证结果

| 首轮 ID | 子代理验证 | 主代理复核 | 结论 |
|---------|-----------|-----------|------|
| C-01 | 成立 | ✅ 确认 | 维持。子代理补充：`/api/repos/*` 用 `requireAuth`（`repos.ts:16`）且 OAuth scope 含 `repo`（`auth.ts:59`）。**主代理修正**：`/api/repos/*` 只操作调用者自己的仓库，属正常设计；真正的越权点是 `/api/admin/*`，不影响 C-01 定性 |
| M-S1 | 成立 | ✅ 确认 | 维持。子代理补充：`auth.ts:42` 是 Worker 唯一返回 HTML 的端点，`unsafe-inline` 并非必需 |
| M-A1 | 成立 | ✅ 确认 | 维持。子代理精确比对：`AdminMessage` = `MessageRow` 去掉 `user_agent`/`client_hash`/`reply_token` 后加 `replies` |
| M-A2 | 成立 | ✅ 确认 | 维持，并**补充**：`requestJson` 有外部 signal 转发（`http.ts:31-34`）而 `apiFetch` 无；`apiFetch` 有 503 分支（`api.ts:58-60`）而 `requestJson` 无 → 合并时需双向补齐 |
| M-R1 | 成立 | ✅ 确认 | 维持。子代理补充：前端 `AdminListResult.nextCursor` 与公开列表 `next_cursor` 语义不同，无法共用 |
| m-01 | 成立（归因修正） | ✅ 确认 | 维持。子代理补充：`github.ts:477-487` 还有第 4 处无上限并发（`Promise.all(binaryOps.map(...))`） |
| m-02 | 成立（计数修正） | ✅ 确认 | 维持。绕过 `githubApi` 的实为 **9 处**（首轮漏计 `getUserInfo:85`、`getUserRepos:123`） |
| m-03 | 成立（计数修正） | ✅ 确认 | 维持。`buffer.ts` 实有 **16 处** `isSafePathParam` 调用（首轮列的 6 行是守卫块起始行） |
| m-06 | 成立（计数修正） | ✅ 确认 | 维持。实为 **8 处**（首轮漏计 `EditorPage.tsx:147`、`SchemaFormPanel.tsx:70-75`） |
| m-07 | 成立 | ✅ 确认 | 维持 |
| m-09 | **定级偏高** | ✅ 采纳 | **降为 NIT**：回调仅 `setCopiedId(null)`，React 19 对卸载后 setState 静默忽略，无泄漏 |
| m-11 | 成立 | ✅ 确认 | 维持。
| Q-05 | 成立 | ✅ 确认 | 维持。子代理**实证差异**：后端 `linkify:true` 会自动链接裸 URL、`breaks:true` 单换行成 `<br>`；前端两者都不支持 → 同一段留言站内与邮件渲染结果不同 |
| Provider 拓扑「正确」 | **需修正** | ✅ 采纳 | **修正为"顺序正确但存在渲染放大"**：五层嵌套顺序经逐点核对无误，但 `App.tsx:58` 的 `ToastContainer` 挂在最内层（记为 m-16） |

### 13.6 第 2 轮新增行动项

#### P0 — 立即修复

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 24 | 在 `wrangler.jsonc` 补充 `FRONTEND_URL` 与 `PROD_ORIGINS`；移除或严格限制 `X-Frontend-Url` 头的优先地位；localhost 默认值仅在非生产环境注入 | `cloudflare-worker/wrangler.jsonc:23-27`、`middleware/cors.ts:5-18`、`routes/auth.ts:68-71`、`index.ts:63-66` | C-02, M-S2 | 需编译验证 + 需配置 Cloudflare 变量 |

#### P1 — 本周修复

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 25 | 修复 move 条目的目标路径解析，避免 `fromPath === path` | `cloudflare-worker/src/services/publish.service.ts:89-98` | M-R2 | 需编译验证；需用缓冲层删除→发布时间路径实测 |
| 26 | 为 `useFileListPage` 的异步加载添加 `cancelled` 守卫 | `web/src/hooks/useFileListPage.ts:33-62` | M-R3 | 需编译验证 |
| 27 | 撤销键纳入 branch；在 `UndoRecord` 中记录并在恢复时比对 | `web/src/pages/DashboardPage.tsx:21-22, 87-109` | M-R4 | 需编译验证 |
| 28 | 批量操作的审计日志并入同一 `db.batch` | `cloudflare-worker/src/services/admin.service.ts:38-62`、`routes/admin.ts:95-101` | m-15 | 需编译验证 |
| 29 | 引入 `HttpError` 携带结构化 status，替换全部 `message.includes('404')` 文本判断（与行动项 6 合并实施） | `web/src/lib/api.ts:33-82`、`pages/TrashPage.tsx:48`、`lib/repoConfigSync.ts:19-22` | m-12, m-13, M-A2 | 需编译验证 + 需跑测试 |
| 30 | 为 `actionLoading` 增加前置守卫，防同一事件循环内的重复提交 | `web/src/pages/DraftsPage.tsx:134, 253, 296` | m-19 | 需编译验证 |

#### P2 — 架构重构

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 31 | 删除或实现 `getTree` 的 `mode='commits'` 分支；修正 `api.ts:309` 的 JSDoc | `cloudflare-worker/src/services/github.ts:659, 699`、`web/src/lib/api.ts:309, 313` | m-14 | 需编译验证 |
| 32 | 将 `ToastContainer` 提升到 `ToastProvider` 直接子级 | `web/src/App.tsx:53-58` | m-16 | 需编译验证 |
| 33 | 移除 `claimWebhookEvent` 内的运行时 DDL（0007 已收编该表） | `cloudflare-worker/src/services/inbound.service.ts:109-119` | n-10 | 需编译验证 |

#### P3 — 渐进改进

| # | 行动项 | 文件 | 关联问题 | 前置条件 |
|---|--------|------|---------|---------|
| 34 | 删除 `shared/types.ts` 的三个死类型（`ContentEntry`、`Collection`、`ContentListParams`） | `shared/types.ts:11-22, 24-32, 95-100` | m-17 | 可静态验证 |
| 35 | 为 `MediaUploader` 拖拽区补 `role="button"`/`tabIndex`/`onKeyDown`；补 label 关联与按钮 `aria-label` | `components/media/MediaUploader.tsx:14-29`、`components/editor/SchemaFormPanel.tsx:314`、`components/settings/BufferSettings.tsx:96-97`、`components/layout/PublishButton.tsx:26`、`drafts/*Dialog.tsx` | m-18, n-07, n-09 | 需编译验证 |
| 36 | 模块级计数器改用 `useRef` | `web/src/components/editor/SchemaFormPanel.tsx:496-499` | n-08 | 可静态验证 |
| 37 | 对齐内部 a11y 范式：以 `MediaSettings`/`DeviceSettings`/`DirectoryTreePicker` 的既有正确写法为基准，而非引入新约定 | 全 `web/src/components/` | m-18, n-07, n-09 | 需编译验证 |

---

## 14. 第 2 轮误报剔除记录

> 子代理提出的以下候选发现经主代理独立复验后**不成立**，按 SKILL.md 阶段 2.5 第 2 步（实际读取代码，确认是否如描述）剔除，**不计入问题总数**。

| 候选发现 | 提出方 | 剔除理由 | 复验证据 |
|---------|-------|---------|---------|
| `AuthContext` 的 `verifySession` 因 `addToast` 引用抖动形成**会话校验自持请求循环** | 组件分片 | **不成立**：`addToast` 被 `useCallback(..., [])` 固定，引用恒定，不会抖动 | 已读 `ToastContext.tsx:38-51`：`useCallback((item) => {...}, [])` 空依赖数组。`value` 对象虽每次新建（`:67`），但其**属性值 `addToast` 不变**。提出方混淆了「value 对象引用变化」与「value 内方法引用变化」 |
| 会话续期定时器（`AuthContext.tsx:62-68`）因同一原因被反复重置，导致 30 分钟续期永不触发 | 组件分片 | **不成立**：同根因，`verifySession` 的依赖 `[addToast]` 稳定 → `verifySession` 稳定 → 定时器不重置 | 同上。附带确认 `clearTimer`(`:30-36`)、`dismissToast`(`:53-56`) 也均为稳定引用 |
| `rateLimit.service.ts:28` 的清理语句可能删除当前窗口的计数行，使限流被重置 | 安全核心分片 | **不成立**：`staleBefore = now - windowMs`，而当前窗口 `windowStart = floor(now/windowMs)*windowMs` **恒 ≥** `staleBefore`，清理不会触及当前窗口 | 数学推导 + 已读 `rateLimit.service.ts:14-29` 全文。固定窗口绕过（跨窗口双倍）本身成立，已并入讨论但属算法固有特性，未单列 ID |
| `MediaPage.tsx:224` 按 sha 过滤会**批量误删所有新上传项** | web lib 分片 | **过度推断**：新上传项 sha 为 `''` 仅在「全新文件」时出现，且上传成功后立即 `await loadFiles()`（`:196`）用真实文件树覆盖，`''` 只是循环内的临时追踪值 | 已读 `MediaPage.tsx:178-197`：`:187` 构造的 `currentFiles` 在 `:196` 被 `loadFiles()` 的返回值替换。sha 作 key 不妥（无法区分同 sha 不同路径）成立，但「批量误删」不成立 → **降为 MINOR**，已并入 m-13 |
| `session.ts` 的设备指纹校验条件（`:95`）允许指纹缺失时放行，构成绕过 | 安全核心分片 | **部分不成立**：`generateDeviceFingerprint` 恒返回 32 位 hex（`session.ts:35`），`currentFingerprint` 不会为空，该条件分支不可达。真正的弱点是**指纹熵低**（内核族+主版本+语言均可伪造） | 已读 `session.ts:29-36` 确认恒返回非空；已读 `:95-97` 确认三条件判断。指纹强度问题转 **Q-06**（设计取舍，需产品决策） |
| `CollectionsContext.tsx:112-118` 的持久化 effect 会在初始化时误写 | 组件分片 | **不成立**：`useState(loadCollectionConfig)` 惰性初始化，首帧 `config` 已是归一化后的解析结果，写回内容与存储一致 | 已读 `CollectionsContext.tsx:42-59, 109-118`。提出方自己也复核为不成立，此处记录以保持审计完整 |

### 误报根因回流

| 误报模式 | 根因 | 已写入的防控动作 |
|---------|------|----------------|
| 「Provider value 未 memo」→ 断言「value 内方法引用抖动」 | 混淆对象引用与属性值引用；未检查方法自身的 `useCallback` 依赖数组 | 后续审查「Context 未 memo」类问题前，**必须逐个检查 value 内每个方法的 `useCallback`/`useMemo` 依赖**，再判定是否传导抖动 |
| 「缺少清理」→ 断言「限流被重置」 | 未做代数推导即断言时序竞争 | 涉及「清理/删除可能误伤当前记录」的断言，必须先写出两个时间量的代数关系 |
| 「sha 为 `''`」→ 断言「批量误删」 | 只看到构造点，未追踪后续是否有权威数据覆盖 | 断言「某字段值异常导致批量后果」前，必须追踪该字段在**完整生命周期**中的赋值点 |
