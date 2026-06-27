# Bloath CMS 代码质量与安全审查报告

**审查日期**: 2026-06-28
**项目**: Bloath CMS - Hugo 博客内容管理系统
**审查范围**: Cloudflare Worker 后端、React 前端、GitHub Actions 部署

---

## 执行摘要

本次审查共发现 **18 个问题**，其中：
- **高危 (Critical)**: 3 个 — 需要立即修复
- **中危 (High)**: 5 个 — 建议尽快修复
- **低危 (Medium)**: 6 个 — 建议优化
- **改进建议 (Low)**: 4 个 — 代码质量提升

---

## 一、安全问题

### [CRITICAL-01] GitHub Access Token 存储在 sessionStorage，易受 XSS 攻击

**严重程度**: 高危
**位置**:
- `web/src/hooks/useAuth.ts` 第 20 行: `sessionStorage.getItem('token')`
- `web/src/hooks/useAuth.ts` 第 46 行: `sessionStorage.removeItem('token')`
- `web/src/pages/LoginPage.tsx` 第 19 行: `sessionStorage.setItem('token', parsed.token)`
- `web/src/lib/api.ts` 多处: 通过 `Authorization: Bearer ${token}` 传递

**问题描述**:
GitHub access_token 直接存储在 sessionStorage 中，任何 XSS 攻击都可以读取该 token。攻击者可以使用该 token 访问用户的 GitHub 仓库，读取、修改或删除内容。

**建议修复**:
```typescript
// 方案: 使用 HttpOnly Cookie 存储 token
// 后端 Cloudflare Worker 设置 Cookie:
// 在 auth callback 中:
return addCorsHeaders(new Response(null, {
  status: 302,
  headers: {
    'Location': redirectUrl,
    'Set-Cookie': `token=${accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`
  }
}), origin, env);

// 前端不再存储 token，由 Cookie 自动携带
// api.ts 中移除 Authorization header 手动设置
```

**替代方案（短期）**: 至少对 token 进行加密存储，并设置较短的过期时间。

---

### [CRITICAL-02] State 参数验证不完整，存在 CSRF 风险

**严重程度**: 高危
**位置**: `cloudflare-worker/src/index.ts` 第 89-104 行

**问题描述**:
`parseState` 函数仅验证 frontendUrl 是否为合法 URL，但**没有验证 HMAC 签名**。这意味着攻击者可以构造任意 frontendUrl 作为 state 参数，可能导致重定向攻击。

```typescript
// 当前代码只做了 URL 格式校验，没有验证签名
function parseState(state: string): { frontendUrl: string; valid: boolean } {
  const parts = state.split(':');
  // ...
  try {
    new URL(frontendUrl);  // 仅格式校验，未验证签名！
    return { frontendUrl, valid: true };
  } catch {
    return { frontendUrl: '', valid: false };
  }
}
```

**建议修复**:
```typescript
function parseState(state: string, env: Env): { frontendUrl: string; valid: boolean } {
  const parts = state.split(':');
  if (parts.length < 3) return { frontendUrl: '', valid: false };

  const randomPart = parts[parts.length - 2];
  const sigHex = parts[parts.length - 1];
  const frontendUrl = parts.slice(0, -2).join(':');

  // 验证 HMAC 签名
  const payload = `${frontendUrl}:${randomPart}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SESSION_SECRET || env.FRONTEND_URL || 'fallback-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const sigBytes = hexToUint8Array(sigHex);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));

  if (!valid) return { frontendUrl: '', valid: false };

  try {
    new URL(frontendUrl);
    return { frontendUrl, valid: true };
  } catch {
    return { frontendUrl: '', valid: false };
  }
}
```

调用处修改:
```typescript
const stateData = parseState(state, env);  // 传入 env 以获取 SESSION_SECRET
```

---

### [CRITICAL-03] GitHub Actions 中敏感 Secret 重复定义且存在泄露风险

**严重程度**: 高危
**位置**: `.github/workflows/deploy.yml` 第 57-79 行

**问题描述**:
1. `GITHUB_CLIENT_SECRET` 和 `SESSION_SECRET` 在 `env` 中以明文形式传递给 wrangler-action，可能被日志记录
2. `Set Wrangler Secrets` 步骤使用 `<<<` herestring 传递 secret，在某些 shell 环境中可能不安全
3. `CF_API_TOKEN` 在多个步骤中重复定义

```yaml
# 第 63-68 行: Secret 直接暴露在 workflow env 中
env:
  GITHUB_CLIENT_SECRET: ${{ secrets.BLOATH_GITHUB_CLIENT_SECRET }}
  SESSION_SECRET: ${{ secrets.BLOATH_SESSION_SECRET }}

# 第 74-76 行: 使用 herestring 可能泄露到日志
run: |
  npx wrangler secret put GITHUB_CLIENT_SECRET <<< "${{ secrets.BLOATH_GITHUB_CLIENT_SECRET }}"
```

**建议修复**:
```yaml
- name: Set Wrangler Secrets
  working-directory: cloudflare-worker
  env:
    CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
    CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
  run: |
    echo "${{ secrets.BLOATH_GITHUB_CLIENT_ID }}" | npx wrangler secret put GITHUB_CLIENT_ID
    echo "${{ secrets.BLOATH_GITHUB_CLIENT_SECRET }}" | npx wrangler secret put GITHUB_CLIENT_SECRET
    echo "${{ secrets.BLOATH_SESSION_SECRET }}" | npx wrangler secret put SESSION_SECRET
```

使用 `echo` 管道替代 `<<<` herestring 更安全。

---

## 二、代码质量问题

### [HIGH-04] CORS 硬编码域名列表，应使用环境变量

**严重程度**: 中危
**位置**: `cloudflare-worker/src/index.ts` 第 24-58 行

**问题描述**:
CORS 允许的域名被硬编码在源码中，每次添加新域名都需要重新部署 Worker。这违反了配置与代码分离的原则。

```typescript
const devOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  // ...
];
const prodOrigins = [
  'https://bloath-cms-web.pages.dev',
  // ...
];
```

**建议修复**:
```typescript
function corsHeaders(origin: string, env: Env): Record<string, string> {
  // 从环境变量读取允许的域名，逗号分隔
  const allowedOrigins = (env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

  const allowedOrigin = allowedOrigins.includes(origin) ? origin : '*';
  // ...
}
```

在 `wrangler.jsonc` 或 Cloudflare 控制面板中添加 `ALLOWED_ORIGINS` 环境变量。

---

### [HIGH-05] request.json() 解析无原型保护，存在原型污染风险

**严重程度**: 中危
**位置**: `cloudflare-worker/src/index.ts` 第 251 行、第 279 行

**问题描述**:
```typescript
const data = await request.json() as Record<string, any>;
const { owner, repo, path: filePath, content, message, sha, branch = 'main', userName } = data;
```

直接使用 `request.json()` 解析用户输入，没有防御 `__proto__` 或 `constructor` 属性注入。攻击者可以发送特殊构造的 JSON 来污染对象原型。

**建议修复**:
```typescript
// 在 index.ts 顶部添加安全的 JSON 解析函数
function safeJsonParse(text: string): Record<string, unknown> {
  const obj = JSON.parse(text) as Record<string, unknown>;
  // 删除危险属性
  delete (obj as any).__proto__;
  delete (obj as any).constructor;
  delete (obj as any).prototype;
  return Object.create(null, obj) as Record<string, unknown>;
}

// 或使用 Object.hasOwn 检查
function validatePayload(data: Record<string, any>): boolean {
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
  return !dangerousKeys.some(key => Object.hasOwn(data, key));
}
```

---

### [HIGH-06] 缺少速率限制，API 端点可被暴力攻击

**严重程度**: 中危
**位置**: 所有 `/api/repos/*` 端点

**问题描述**:
没有任何速率限制机制，攻击者可以：
- 暴力枚举仓库路径
- 对 `/api/repos/file` 发起大量 DELETE 请求破坏内容
- 通过 `/api/auth/callback` 进行暴力破解

**建议修复**:
使用 Cloudflare Workers 的 `RateLimit` 绑定（需要 Cloudflare Enterprise 计划），或在 Cloudflare 仪表板设置 WAF 规则。对于免费计划，可以实现简单的内存计数：

```typescript
// 在 Worker 中添加简单的请求计数
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const record = requestCounts.get(key);

  if (!record || now > record.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}
```

---

### [MEDIUM-07] useAuth hook 中 handleCallback 引用了旧的 sessionKey 模式

**严重程度**: 低危
**位置**: `web/src/hooks/useAuth.ts` 第 63-75 行

**问题描述**:
```typescript
const handleCallback = async (code: string, stateVal: string) => {
  const res = await fetch(`${API_BASE}/api/auth/callback?code=${code}&state=${stateVal}`);
  const data = await res.json();
  if (data.success) {
    sessionStorage.setItem('token', data.sessionKey);  // data.sessionKey 已不存在
    setState({ user: data.user, token: data.sessionKey, loading: false });
  }
};
```

后端已将认证流程改为 fragment 传递 token（LoginPage.tsx 第 18 行），但 `handleCallback` 仍在引用不存在的 `data.sessionKey` 和 `data.user` 字段。这是一个死代码路径。

**建议修复**:
删除 `handleCallback` 函数，因为当前认证流程已通过 fragment 方式处理。保留该函数仅用于"旧路径兼容"，但应添加明确注释标记为废弃。

---

### [MEDIUM-08] 缺少 Content-Security-Policy 响应头

**严重程度**: 低危
**位置**: `cloudflare-worker/src/index.ts` 全文件

**问题描述**:
Worker 没有设置 CSP 头，攻击者可能通过 XSS 注入恶意脚本。

**建议修复**:
```typescript
function addCorsHeaders(response: Response, origin: string, env: Env): Response {
  Object.entries(corsHeaders(origin, env)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // 添加安全头
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}
```

---

### [MEDIUM-09] writeFile 函数未校验 content 大小

**严重程度**: 低危
**位置**: `cloudflare-worker/src/index.ts` 第 246-272 行

**问题描述**:
GitHub API 限制单个文件最大 100MB，但代码没有校验 content 大小。过大的请求会导致 API 调用失败。

**建议修复**:
```typescript
if (content.length > 10 * 1024 * 1024) {  // 10MB 限制
  return addCorsHeaders(Response.json({ error: 'File too large' }, { status: 400 }), origin, env);
}
```

---

## 三、命名与代码规范问题

### [LOW-10] isValidParam 函数命名不够清晰

**严重程度**: 极低
**位置**: `cloudflare-worker/src/index.ts` 第 7-12 行

**问题描述**:
`isValidParam` 函数名过于笼统，不清楚校验的是什么。建议改为更具体的名称。

**建议修复**:
```typescript
function isSafePathSegment(value: string | null, allowSlash = false): boolean {
  // ...
}
```

---

### [LOW-11] 重复的路由匹配逻辑

**严重程度**: 极低
**位置**: `cloudflare-worker/src/index.ts` 第 297-318 行

**问题描述**:
分支列表的路由条件使用了冗余的 OR 逻辑：
```typescript
if (url.pathname === '/api/repos/branches' ||
    url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
```

两个条件有重叠，应该统一使用一种匹配方式。

---

### [LOW-12] Frontend 中多处使用魔法数字

**严重程度**: 极低
**位置**:
- `web/src/lib/api.ts` 第 55 行: `10000` (超时时间)
- `web/src/styles/globals.css` 多处: `#FAFAFA`, `#1F1F1F` 等色值

**建议修复**:
```typescript
// api.ts
const API_TIMEOUT_MS = 10000;
setTimeout(() => controller.abort(), API_TIMEOUT_MS);
```

---

## 四、模块化与架构问题

### [MEDIUM-13] 路由分发逻辑过于集中

**严重程度**: 中危
**位置**: `cloudflare-worker/src/index.ts` 第 106-330 行

**问题描述**:
所有 API 路由都集中在 `fetch` 方法中，超过 200 行的 if-else 链不利于维护和测试。

**建议修复**:
```typescript
// 将路由拆分为独立的处理器
const routes = {
  '/api/auth/login': authLoginHandler,
  '/api/auth/callback': authCallbackHandler,
  '/api/me': meHandler,
  // ...
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const handler = routes[url.pathname];
    if (handler) {
      return handler(request, env, ctx, url);
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};
```

---

### [MEDIUM-14] EditorPage 组件过大（843 行）

**严重程度**: 中危
**位置**: `web/src/pages/EditorPage.tsx`

**问题描述**:
单个组件超过 800 行，承担了编辑器初始化、文件读写、frontmatter 编辑、发布、删除、键盘事件处理等多种职责。

**建议拆分**:
- `FrontmatterForm.tsx` — frontmatter 表单逻辑
- `EditorToolbar.tsx` — 工具栏和发布逻辑
- `useEditorInitialization.ts` — Vditor 初始化的 custom hook
- `useKeyboardShortcuts.ts` — 键盘事件处理

---

### [MEDIUM-15] parseFrontmatter 正则表达式过于宽松

**严重程度**: 中危
**位置**: `web/src/pages/EditorPage.tsx` 第 29-31 行

**问题描述**:
```typescript
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
```
该正则没有考虑 frontmatter 中可能包含 `---` 的情况（如代码块中的分隔符），可能导致解析错误。

**建议修复**:
```typescript
// 更严格的 frontmatter 解析
function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw.trim() };

  try {
    const fm = yaml.load(match[1]) as Frontmatter;
    return { fm, body: match[2]?.trim() || '' };
  } catch {
    return { fm: {}, body: raw.trim() };
  }
}
```

---

### [LOW-16] 未使用的导出函数 getAuthUrl

**严重程度**: 极低
**位置**: `cloudflare-worker/src/github.ts` 第 12-20 行

**问题描述**:
`getAuthUrl` 函数被导出但从未被调用。认证 URL 直接在 `index.ts` 中构建。

**建议**: 删除此未使用的函数，减少代码体积。

---

### [LOW-17] 错误处理不一致

**严重程度**: 低危
**位置**: 多处

**问题描述**:
- `exchangeCode` 抛出异常（第 40 行）
- `getUserRepos` 抛出异常（第 92 行）
- `listDir` 返回原始错误信息（第 237 行）
- `getRepoBranches` 静默返回默认值（第 268 行）

**建议**: 统一错误处理策略，所有 API 调用要么抛出结构化错误，要么返回错误对象。

---

### [LOW-18] 前端 API 调用缺少错误边界

**严重程度**: 低危
**位置**: `web/src/lib/api.ts`

**问题描述**:
所有 API 函数在 `res.json()` 失败时没有 try-catch，网络错误会直接传播到组件层。

**建议修复**:
```typescript
async function safeFetch(url: string, options: RequestInit): Promise<any> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('网络连接失败');
    }
    throw err;
  }
}
```

---

## 五、修复优先级总结

| 优先级 | 编号 | 问题 | 影响 |
|--------|------|------|------|
| P0 | CRITICAL-01 | Token 存储在 sessionStorage | 用户数据泄露 |
| P0 | CRITICAL-02 | State 参数未验证签名 | CSRF 攻击 |
| P0 | CRITICAL-03 | GitHub Actions Secret 泄露风险 | 凭据泄露 |
| P1 | HIGH-04 | CORS 硬编码 | 运维困难 |
| P1 | HIGH-05 | 原型污染风险 | 安全绕过 |
| P1 | HIGH-06 | 无速率限制 | API 滥用 |
| P2 | MEDIUM-07 | 死代码 handleCallback | 代码混乱 |
| P2 | MEDIUM-08 | 缺少安全响应头 | 安全风险 |
| P2 | MEDIUM-13 | 路由集中式 | 可维护性差 |
| P2 | MEDIUM-14 | EditorPage 过大 | 可维护性差 |
| P2 | MEDIUM-15 | Frontmatter 解析缺陷 | 数据损坏 |
| P3 | LOW-10 ~ 18 | 命名、架构、错误处理 | 代码质量 |

---

## 六、测试建议

建议为以下模块添加单元测试：

1. **`parseState` 函数** — 测试有效/无效 state 的解析和签名验证
2. **`isValidParam` 函数** — 测试各种非法路径注入
3. **`safeJsonParse` 函数** — 测试原型污染防御
4. **`exchangeCode` 函数** — 测试 OAuth token 交换失败场景
5. **`writeFile` 函数** — 测试文件大小限制

---

*报告结束*
