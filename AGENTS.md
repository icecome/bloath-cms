# AGENTS.md

本文件记录 Bloath CMS 的项目级工程约定，供后续开发者与 AI 助手遵循。
格式为「约定 → 依据 → 边界条件」，凡涉及权衡的条目均给出理由与适用条件，便于后续调整。

---

## 前端 React 约定

### 最新值 ref（latest-value ref）

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

### 异步加载的陈旧响应防护

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

### Context value 稳定性

Provider 的 `value` 若为对象字面量，应使用 `useMemo` 包装；其中每个方法应使用 `useCallback`。
**注意**：判定"value 抖动是否传导到下游"时，需逐个检查 value 内**方法自身的依赖数组** —— value 对象引用变化不等同于其属性值变化。

---

## 后端 Cloudflare Worker 约定

### 管理接口授权

`/api/admin/*` 由 `requireAdminAuth` 守卫，该校验包含三层：CSRF → 会话有效性（含设备指纹）→ **GitHub 用户名白名单**（`ADMIN_GITHUB_LOGIN`）。

**未配置 `ADMIN_GITHUB_LOGIN` 时管理接口一律拒绝**（fail-closed），这是刻意设计：避免"忘记配置即全部开放"。部署新环境时必须显式配置该变量。

### 存储读取的结构校验

从 D1 `app_settings` 这类**共享表**读取 JSON 值时，应使用 Zod schema 校验结构而非直接类型断言。
依据：该类表可能被运维脚本或其他模块写入，字段类型异常时直接断言会导致 `TypeError` 被外层 catch 静默吞掉，形成难以排查的降级。
参考实现：`cloudflare-worker/src/services/bufferConfig.service.ts` 的 `storedConfigSchema`。

### 会话吊销

登出除清除 cookie 外，必须推进服务端吊销门槛（`revokeSessions`）。仅清 cookie 无法使已泄露的 token 失效。

### 并发控制

批量异步操作使用 `cloudflare-worker/src/lib/concurrency.ts` 的 `mapLimit`，避免无上限 `Promise.all`。
注意区分两类语义：`mapLimit` 内任一失败即整体抛出；若需要"部分成功"的结果，使用 `Promise.allSettled` 并显式处理失败项。

### 错误消息与状态码

前后端间**禁止**用 `err.message.includes('404')` 一类文本匹配判断 HTTP 状态码。
前端统一使用 `web/src/lib/http.ts` 的 `HttpError`，按 `err.status` 数字判断。

---

## 渲染一致性

留言正文在两处渲染，规则必须保持一致：

- 站内：`web/src/lib/messageMarkdown.ts`（markdown-it 动态 import，不占主包）
- 邮件：`cloudflare-worker/src/services/email.service.ts` 的 `renderMarkdown`

两处均使用 `{ html: false, linkify: true, breaks: true }` 并重写 `validateLink` 限制协议。
**修改任一处必须同步另一处**，否则同一段留言在站内与邮件中的排版会出现差异。

---

## 相关文档

- `docs/code-review-report-2026-09.md` — 代码审查报告（含 2 轮结论）
- `CODE_REUSE_LOG.md` — 代码复用决策留痕（项目根）
- `docs/reviews/` — 历史架构审查与复用审查文档
