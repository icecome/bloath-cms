# 草稿箱「预发布」功能设计方案

> **文档类型：** 功能设计（需求 + 架构 + 交互）
> **适用项目：** Bloath CMS（Cloudflare Worker + React 19 SPA）
> **设计日期：** 2026-09
> **状态：** 待评审

---

## 1. 需求确认

### 1.1 需求原文

| # | 需求 |
|---|------|
| R1 | 草稿箱新增「预发布路径」列，显示每个草稿的预发布目标位置 |
| R2 | 工具栏「发布」拆分为「发布」与「预发布」两个独立按钮 |
| R3 | 设计草稿箱完整功能架构（创建/保存/编辑/预览/预发布/发布/删除） |
| R4 | 定义预发布与正式发布的关系与状态转换机制 |
| R5 | 设计草稿状态标识系统（未发布/预发布中/已预发布/已发布） |
| R6 | 规划界面布局与交互流程，保持与现有系统一致 |

### 1.2 关键决策（已与需求方确认）

| 决策点 | 结论 | 含义 |
|--------|------|------|
| 预发布的技术含义 | **仅标记状态**，标识草稿即将发布到的指定目录 | 不推分支、不触发部署、不产生预览 URL |
| 正式发布是否必经预发布 | **强制** —— 未预发布不能发布 | 预发布成为发布前的确认关卡 |
| 预发布路径来源 | **用户指定**预发布目录 | 与现有 `publishTargets` 机制同源 |
| 能否取消预发布 | **支持**，回到未发布态 | 非单向流程 |
| 状态存储 | **复用 S3 缓冲层基础设施**，独立命名空间 | 不引入配置文件、不新建 D1 表 |

### 1.3 设计范围边界（本次不做）

明确排除，避免范围蔓延：

- 不实现真实的预览渲染（不做 draft 站点、不做临时域名）
- 不实现定时发布 / 预约发布
- 不实现多人协作与审批流
- 不改变现有的 git commit 与 CI 触发策略（`deploySettings.ts` 保持原样）

---

## 2. 现状勘察

### 2.1 草稿箱当前架构

```
┌─────────────────────────────────────────────────────────────┐
│ DraftsPage.tsx                                              │
│                                                             │
│  useFileListPage（扫描 .draft/ 的仓库文件）                  │
│         │                                                   │
│         ├── files: EnhancedFileItem[]     ← 仓库草稿         │
│         │                                                   │
│  useBuffer()                                                │
│         │                                                   │
│         ├── changes: BufferChangeItem[]   ← S3 缓冲清单      │
│         │                                                   │
│         ▼                                                   │
│  mergeDraftList(files, changes, draftPath)                  │
│         │                                                   │
│         ▼                                                   │
│  mergedFiles: EnhancedFileItem[]                            │
│    source: 'repo' | 'buffer' | 'buffer-modified' |          │
│            'buffer-deleted'                                 │
│                                                             │
│  publishTargets: Record<path, target>  ← ⚠️ useState，刷新即丢│
└─────────────────────────────────────────────────────────────┘
```

### 2.2 两套发布目标的现状差异

| 草稿类型 | `source` | 目标路径存储 | 持久化 |
|---------|---------|------------|--------|
| 仓库草稿 | `repo` | `DraftsPage.tsx:64` 的 `useState` | **丢失**（刷新/切换仓库即重置） |
| 缓冲项 | `buffer` / `buffer-modified` | S3 缓冲条目内的 `publishTarget` 字段（`buffer.service.ts:87-100`） | 持久 |

**这是核心痛点**：仓库草稿（截图中的"仓库"标签项）的目标路径是纯临时状态，用户在发布对话框中选完目标后，只要刷新页面或切换目录就必须重选。

### 2.3 现有「发布」的实际行为

`DraftsPage.tsx:148-217` 的 `handlePublish` 做两件事：

```ts
// 仓库草稿：按 publishTargets 指定的目标 move 到目标目录
const moveOps = repoItems.map(file => ({
  op: 'move', fromPath: file.path, path: `${safeTarget}/${file.name}`
}));
await commitBatch({ ..., ops: moveOps });

// 缓冲项：走逐项发布接口，后端重写路径后 commit
await publish(user.login, bufferItems.map(f => ({ path: f.path, publishTarget })));
```

**所以"发布" = 把文件从 `.draft/` 移出 + git commit**，commit message 是否带 `[skip ci]` 由 `deploySettings` 策略决定。

### 2.4 可复用的既有能力

| 能力 | 位置 | 复用方式 |
|------|------|---------|
| S3 对象读写 | `cloudflare-worker/src/services/s3.client.ts` | 预发布状态的存储后端 |
| 缓冲配置（含密钥加密） | `bufferConfig.service.ts` | 直接复用，无需新配置 |
| 路径参数校验 | `middleware/pathGuard.ts` 的 `isSafePathParam` | 复用校验 `previewTarget` |
| 请求鉴权 | `middleware/sessionAuth.ts` 的 `requireAuth` | 新端点复用 |
| 目录树选择器 | `DirectoryTreePicker.tsx` | 预发布目标选择的 UI 复用 |
| 响应封装 | `comment/utils/response.ts` 的 `success`/`error` | 新端点复用 |
| 并发控制 | `lib/concurrency.ts` 的 `mapLimit` | 批量预发布时复用 |

---

## 3. 状态模型设计

### 3.1 状态定义

草稿的生命周期共 **5 个状态**（而非需求中的 4 个 —— 增加"待发布确认"以覆盖"预发布后内容又被修改"的情况）：

| 状态 ID | 显示名 | 含义 | 判定条件 |
|---------|-------|------|---------|
| `draft` | 草稿 | 尚未预发布 | 无预发布记录 |
| `previewed` | 已预发布 | 已指定目标，等待发布 | 有预发布记录，且内容哈希未变 |
| `preview-stale` | 预发布已过期 | 预发布后内容又被修改 | 有预发布记录，但内容哈希已变 |
| `publishing` | 发布中 | 正在执行发布（瞬时态） | 前端 `actionLoading` |
| `published` | 已发布 | 已移出草稿目录 | 不再出现在草稿箱列表中 |

> **为何增加 `preview-stale`**：若用户预发布后又编辑了文件，原目标路径可能已不适用（如标题改了、分类变了）。若不区分，会出现"看着是已预发布，实际内容与预发布时不符"的隐患。这是设计中对一致性的一处主动加固。

### 3.2 状态转换图

```
                    ┌──────────────┐
                    │    draft     │ ← 新建草稿 / 取消预发布
                    │   （草稿）    │
                    └──────┬───────┘
                           │
                    「预发布」+ 指定目标
                           │
                           ▼
                    ┌──────────────┐
        内容未改 ───│  previewed   │─── 编辑内容 ───┐
                    │ （已预发布）  │                │
                    └──────┬───────┘                ▼
                           │                 ┌─────────────────┐
                           │                 │ preview-stale   │
                           │                 │（预发布已过期）  │
                           │                 └────────┬────────┘
                           │                          │
                           │                   重新预发布
                           │                          │
                           │                          ▼
                           │                  回到 previewed
                           │
                      「发布」
                           │
                           ▼
                    ┌──────────────┐
                    │  publishing  │（瞬时）
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  published   │（移出草稿箱）
                    └──────────────┘
```

**转换规则表**：

| 起始态 | 操作 | 目标态 | 前置校验 | 副作用 |
|-------|------|-------|---------|--------|
| `draft` | 预发布 | `previewed` | 必须指定非空目标目录 | 写预发布记录 |
| `previewed` | 发布 | `published` | — | commit + 清理预发布记录 |
| `previewed` | 取消预发布 | `draft` | — | 删预发布记录 |
| `previewed` | 编辑保存 | `preview-stale` | — | 内容哈希变化 |
| `preview-stale` | 预发布 | `previewed` | 目标非空 | 更新记录的哈希与时间 |
| `preview-stale` | 发布 | `published` | ⚠️ 需二次确认 | commit + 清理 |
| `preview-stale` | 取消预发布 | `draft` | — | 删记录 |
| `draft` | 发布 | — | ❌ **阻断** | 按钮置灰 + 提示先预发布 |
| `previewed` / `preview-stale` | 删除 | — | — | 移入回收站 + 删记录 |

### 3.3 状态标识的视觉设计

按项目现有的 `FileTable.tsx:4-9` 的 `SOURCE_META` 模式扩展（同一套徽标风格，保持一致性）：

| 状态 | 徽标文案 | 配色 | 依据 |
|------|---------|------|------|
| `draft` | 草稿 | `bg-secondary text-muted-foreground` | 中性灰，与现有"仓库"标签一致 |
| `previewed` | 已预发布 | `bg-blue-100 text-blue-700` | 蓝色表"待执行"，与现有 orange(缓存)/red(待删除) 不冲突 |
| `preview-stale` | 预发布过期 | `bg-amber-100 text-amber-700` | 琥珀色表"需注意"，复用现有 `MediaSettings.tsx:199` 的 amber 用法 |

> **配色理由**：项目现有徽标色为 `orange`(缓存)、`red`(待删除)、`secondary`(仓库)。预发布相关状态新增 blue 与 amber，与既有三色在色相上有明确区分，且都不使用紫色 —— 符合项目"拒绝套路化配色"的既有倾向。

---

## 4. 数据模型设计

### 4.1 存储方案

**复用 S3 缓冲层基础设施，使用独立命名空间**。

```
S3 Key 结构对比：

现有缓冲条目（不动）：
  {prefix}/{rand}/{owner}/{repo}/{branch}/{path}.buf

新增预发布记录：
  {prefix}/{rand}/{owner}/{repo}/{branch}/.preview/{path}.json
                        └──────┬──────┘
                     新增一级目录隔离
```

**为何用独立前缀而非扩展 `BufferEntry`**：

| 方案 | 问题 |
|------|------|
| 复用 `BufferEntry` 加字段 | `BufferEntry.op` 是必需的（`write`/`delete`/`move`），而 `mergeDraftList:39` 会把 `op:'write'` 判为"缓存·有改动" → **仓库草稿会被误标为已修改** |
| `setBufferPublishTarget` | 该函数要求条目已存在（`buffer.service.ts:91` 的 `if (!existing) return false`），仓库草稿在 S3 无条目 → 无法使用 |
| **独立前缀（本方案）** | 与缓冲条目物理隔离，`mergeDraftList` 完全无感，无需修改其逻辑 |

### 4.2 数据结构

```typescript
// shared/types.ts 新增（前后端共用）

/** 草稿的预发布状态 */
export type DraftPreviewState = 'draft' | 'previewed' | 'preview-stale';

/** 预发布记录（存 S3，key: {repoPrefix}.preview/{path}.json） */
export interface DraftPreviewRecord {
  /** 数据格式版本，便于后续演进 */
  version: 1;
  /** 草稿在仓库中的路径，如 .draft/20260928-测试文章.md */
  path: string;
  /** 预发布目标目录，如 content/posts */
  previewTarget: string;
  /** 预发布时的内容 SHA（git blob sha），用于检测预发布后内容是否变化 */
  contentSha: string;
  /** 预发布操作时间戳 */
  previewedAt: number;
  /** 执行预发布的操作者（GitHub login），用于多设备场景追溯 */
  previewedBy?: string;
}
```

### 4.3 内容哈希的取值

用**草稿文件的 git blob sha**（`EnhancedFileItem.sha`）而非内容哈希：

- 仓库草稿的 `sha` 已由 `scanner.ts` → `getTree` 提供，**零额外成本**
- 缓冲项的 `sha` 来自 `draftMerge.ts:46` 的 `prev?.sha`，同样已有
- 文件内容变化时 git 必然重算 sha → 天然可作变更检测

**边界情况**：新建的缓冲项 `sha` 为 `''`（`draftMerge.ts:61`）。此时以 `''` 存记录，下次比对仍为 `''`，不会误判为"过期" —— 但也不会检测到变化。**处理**：对 `sha` 为空的条目，在记录中额外存 `savedAt` 作为兜底比对依据。

---

## 5. 后端 API 设计

### 5.1 端点清单

沿用现有 `/api/buffer/*` 前缀与 `requireAuth` 守卫，保持路径语义聚合：

| 方法 | 路径 | 用途 | 复用 |
|------|------|------|------|
| `GET` | `/api/buffer/previews` | 列出本仓库所有预发布记录 | `listObjects` |
| `PUT` | `/api/buffer/preview` | 设置/更新单条预发布（含目标路径） | `putObject` |
| `DELETE` | `/api/buffer/preview` | 取消单条预发布 | `deleteObject` |
| `POST` | `/api/buffer/preview/batch` | 批量预发布（多选场景） | `mapLimit` |

### 5.2 端点契约

#### `GET /api/buffer/previews?owner&repo&branch`

```typescript
// 响应
{
  code: 0,
  data: {
    items: DraftPreviewRecord[],
    count: number
  }
}
```

#### `PUT /api/buffer/preview`

```typescript
// 请求体
{
  owner: string;
  repo: string;
  branch?: string;      // 默认 main
  path: string;         // 草稿路径，如 .draft/xxx.md
  previewTarget: string; // 目标目录，如 content/posts
  contentSha: string;    // 当前内容 sha（由前端传入，来自列表项）
}

// 校验（复用 isSafePathParam）
- owner / repo / branch：不允许斜杠
- path / previewTarget：允许斜杠，禁止 `..`
- previewTarget 非空
```

#### `DELETE /api/buffer/preview?owner&repo&branch&path`

取消预发布，返回 204。

#### `POST /api/buffer/preview/batch`

```typescript
{
  owner, repo, branch?,
  items: Array<{ path: string; previewTarget: string; contentSha: string }>
}

// 响应包含逐项结果，容忍部分失败
{
  code: 0,
  data: {
    succeeded: string[],   // 成功的 path
    failed: Array<{ path: string; error: string }>
  }
}
```

> **为何用 `Promise.allSettled` 语义而非全成或全败**：批量预发布是幂等的元数据写入，部分成功比整体失败对用户更友好（失败项可重试）。这与 `AGENTS.md` 中"需要部分成功的结果，使用 `Promise.allSettled` 并显式处理失败项"的既有约定一致。

### 5.3 新增服务模块

```typescript
// cloudflare-worker/src/services/draftPreview.service.ts

// 与 buffer.service.ts 同构：复用 s3.client 与 bufferConfig
export async function listDraftPreviews(env, owner, repo, branch): Promise<DraftPreviewRecord[]>
export async function setDraftPreview(env, owner, repo, branch, record): Promise<void>
export async function deleteDraftPreview(env, owner, repo, branch, path): Promise<void>
export async function readDraftPreview(env, owner, repo, branch, path): Promise<DraftPreviewRecord | null>
```

**key 构造**（与 `buffer.service.ts:42-49` 对称）：

```typescript
function previewKey(cfg: BufferConfig, owner, repo, branch, path): string {
  return `${cfg.prefix}/${cfg.rand}/${owner}/${repo}/${branch}/.preview/${path}.json`;
}
function previewPrefix(cfg: BufferConfig, owner, repo, branch): string {
  return `${cfg.prefix}/${cfg.rand}/${owner}/${repo}/${branch}/.preview/`;
}
```

**注意**：`listObjects` 是按前缀列举的，而 `.preview/` 在 `repoPrefix()` 之下 —— 现有 `listBufferChanges` 会把这些对象**一起列出来**。

**但无需额外过滤代码**（已实证）：`pathFromKey`（`buffer.service.ts:52-55`）的判定是

```ts
if (!key.startsWith(prefix) || !key.endsWith('.buf')) return null;
```

它同时检查**前缀**与 **`.buf` 后缀**。预发布记录用 `.json` 后缀，会被 `endsWith('.buf')` 直接排除，因此 `listBufferChanges` 与 `readBufferFull` 都不会看到它们。

**实测验证**（用 node 跑 `pathFromKey` 的原样逻辑）：

| 输入 key | 返回值 | 结论 |
|---------|-------|------|
| `{prefix}.draft/文章.md.buf` | `.draft/文章.md` | 正常缓冲条目 |
| `{prefix}.preview/.draft/文章.md.json` | `null` | **被排除** |
| `{prefix}.preview/.draft/文章.md.buf` | `.preview/.draft/文章.md` | 会被误收 —— 故**必须坚持 `.json` 后缀** |

**由此产生一条硬性实现约束**：预发布记录的 key **必须使用 `.json` 后缀**。若将来有人改成 `.buf`，会立即引发"预发布记录被当作待发布文件写进 commit"的故障（仓库里出现 `.preview/*.buf` 文件）。

建议加一个单元测试锁定该后缀约定。

---

## 6. 前端设计

### 6.1 数据流改造

```
┌──────────────────────────────────────────────────────────────┐
│ DraftsPage.tsx                                               │
│                                                              │
│  useFileListPage ──► files（仓库草稿）                        │
│  useBuffer ───────► changes（S3 缓冲清单）                    │
│  useDraftPreviews ─► previews（S3 预发布记录）  ← 🆕 新增 hook │
│                                                              │
│         ▼                                                    │
│  mergeDraftList(files, changes, draftPath)                   │
│         │                                                    │
│         ▼                                                    │
│  mergePreviewState(merged, previews)  ← 🆕 纯函数，叠加状态     │
│         │                                                    │
│         ▼                                                    │
│  mergedFiles: EnhancedFileItem[]                             │
│    + previewState?: DraftPreviewState   ← 🆕 新增字段          │
│    + previewTarget?: string             ← 复用已有字段名       │
└──────────────────────────────────────────────────────────────┘
```

**`useDraftPreviews` hook**（新文件 `web/src/hooks/useDraftPreviews.ts`）：

- 参照 `BufferContext` 的实现范式（`useMemo` 包装 value、`useCallback` 包裹方法）
- 方法：`previews`、`refreshPreviews`、`setPreview`、`cancelPreview`、`batchPreview`
- 在 `selectedRepo` 变化时自动刷新（`useEffect` 依赖 `[selectedRepo, config?.enabled]`）
- **必须加陈旧响应守卫**（用 `cancelled` 标志，对齐 `useFileListPage.ts` 修复后的范式）

### 6.2 表格列设计

**新增「预发布路径」列**，位置放在「路径」与「来源」之间（语义递进：当前路径 → 将来去处 → 数据来源）：

| 列 | 宽度（调整后） | 内容 |
|----|--------------|------|
| 文件名 | `w-[26%]` | 原 35% → 26% |
| 路径 | `w-[26%]` | 原 35% → 26% |
| **预发布路径** 🆕 | `w-[20%]` | 目标目录，未预发布时显示 `—` |
| 来源 | `w-[10%]` | 原 12% → 10% |
| 状态 🆕 | `w-[10%]` | 状态徽标（或与来源合并） |
| 操作 | `flex-1 text-right` | 不变 |

> **列宽取舍说明**：CJK 文件名与路径在 26% 宽度下仍可显示约 12-14 个字符（配合 `truncate` + `title` 悬浮完整值），是可接受的折中。若表格总宽不够，可将「状态」合并进「来源」列（同时显示两个徽标）。

**「预发布路径」列的三态显示**：

| 状态 | 显示 | 样式 |
|------|------|------|
| `draft` | `—` | `text-muted-foreground` |
| `previewed` | `content/posts` | `text-foreground`，可点击 |
| `preview-stale` | `content/posts` + ⚠️ | `text-amber-700`，加警示图标 |

**空值处理**：未预发布显示 `—` 而非留空 —— 明确表达"尚未指定"而非"加载中"。

### 6.3 工具栏按钮布局

**拆分后**（对应需求 R2）：

```
┌─────────────────────────────────────────────────────────────┐
│ 已选 2 篇 │ 全选 │ [发布] [预发布] │ 移动 │ 删除 │ 重命名      │
└─────────────────────────────────────────────────────────────┘
```

**按钮的启用规则**（这是"强制预发布"的落地点）：

| 按钮 | 启用条件 | 禁用时的提示 |
|------|---------|------------|
| **预发布** | 选中数 ≥ 1 | — |
| **发布** | 选中项**全部**满足以下之一：① `previewed` ② `preview-stale`（需二次确认） | 悬浮 tooltip：`有 2 篇尚未预发布，请先预发布` |

**视觉层级**：
- 「发布」保持主色（`text-primary`，同现状）
- 「预发布」用次要色（`text-muted-foreground`），因为它是流程前置步骤而非终点

**按钮顺序**：`发布` 在前、`预发布` 在后 —— 与现有习惯一致（现有唯一按钮就是"发布"，用户肌肉记忆在左侧）；且按视觉权重降序排列。

> 这一顺序有争议：按流程顺序应"预发布"在前。但按**操作频率与视觉权重**，"发布"是用户最终目标，放前面更符合现有 UI。若团队更看重流程顺序，可对调（设计上是等价的，仅需调整 JSX 顺序）。

### 6.4 预发布对话框

**复用 `PublishDraftDialog` 的交互范式**，但语义不同，需要新组件 `PreviewDraftDialog`。

**关键差异对比**：

| 维度 | PublishDraftDialog（现有） | PreviewDraftDialog（新增） |
|------|--------------------------|--------------------------|
| 标题 | 发布 N 篇草稿 | 预发布 N 篇草稿 |
| 说明文案 | 「未指定目标的文章将发布到草稿目录」 | 「预发布仅标记目标位置，不会产生提交；确认后需再点『发布』」 |
| 目标选择 | `DirectoryTreePicker` | **复用同一组件** |
| 确认按钮 | 确认发布 | 确认预发布 |
| 是否允许空目标 | 允许（提示会留在草稿目录） | **不允许**（预发布必须有明确目标） |

**空目标不允许的理由**：现有"发布"允许空目标（文件留在草稿目录），但"预发布"若允许空目标就失去意义 —— 它的全部价值就是固化"发到哪里"。

**批量模式的默认行为**：
- 选中 1 篇 → 直接进入逐篇模式（沿用 `PublishDraftDialog:37-39` 的既有逻辑）
- 选中多篇 → 默认「统一目标」模式，用户可切「逐篇指定」

### 6.5 交互流程

#### 流程 A：单篇完整发布

```
1. 用户点击「预发布」
   └─► 弹出 PreviewDraftDialog
       └─► 选择目标目录 content/posts
           └─► 确认
               └─► PUT /api/buffer/preview
                   └─► 状态变为「已预发布」，列显示 content/posts
                       └─► Toast: 已标记预发布目标：content/posts

2. 用户点击「发布」
   └─► 校验通过（已预发布）
       └─► commitBatch，move 到 content/posts
           └─► 删除预发布记录
               └─► 成功后草稿从列表移除
                   └─► Toast: 已发布 1 篇
```

#### 流程 B：预发布后编辑（触发 stale）

```
1. 已预发布（content/posts）
2. 用户点「编辑」→ 在编辑器中修改并保存
3. 返回草稿箱
   └─► 内容 sha 变化 → 状态判定为「预发布已过期」
       └─► 列显示 content/posts + ⚠️，徽标变琥珀色
4. 用户点「发布」
   └─► 弹出二次确认：
       「1 篇草稿在预发布后已被修改，目标路径可能已不适用。
         确认按原目标 content/posts 发布？」
       ├─► 确认 → 正常发布
       └─► 取消 → 停留在当前态，可重新预发布
```

#### 流程 C：取消预发布

```
1. 已预发布项，行内操作区显示「取消预发布」（或右键菜单）
2. 点击 → DELETE /api/buffer/preview
3. 状态回到 draft，列显示 —
   └─► Toast: 已取消预发布
```

#### 流程 D：混合选中（部分已预发布）

```
选中的 3 篇中，2 篇已预发布、1 篇未预发布

点「发布」：
  └─► 按钮禁用，tooltip: 有 1 篇尚未预发布，请先预发布

点「预发布」：
  └─► 弹窗只列出未预发布的 1 篇
      └─► 说明文案：「已跳过 2 篇已预发布的草稿」
          └─► 确认后仅更新那 1 篇
```

> **流程 D 的设计意图**：不因"部分已预发布"而阻断整个操作，也不重复处理已预发布项 —— 减少用户的操作次数。已预发布项如需改目标，应通过单项操作（点击列内路径）修改。

### 6.6 行内操作扩展

现有行内操作（`DraftsPage.tsx:558-592`）：编辑、删除。

**新增**（按频次排序）：

| 操作 | 位置 | 显示条件 |
|------|------|---------|
| 编辑 | 桌面/移动 | 始终 |
| 预发布 | 桌面/移动 | `draft` 或 `preview-stale` |
| 取消预发布 | 桌面/移动 | `previewed` 或 `preview-stale` |
| 删除 | 桌面/移动 | 始终 |

**「预发布」按钮在 `previewed` 态隐藏**，因为已预发布无需重复操作（若需改目标，点击列内路径即可，或先取消）。

---

## 7. 实现路径规划

### 7.1 分阶段实施

| 阶段 | 内容 | 交付物 | 依赖 |
|------|------|--------|------|
| **P1 后端** | `draftPreview.service.ts` + 4 个端点 + `buffer.service` 的 `.preview/` 过滤 | 可用 API | 无 |
| **P2 状态层** | `shared/types.ts` 类型 + `useDraftPreviews` hook + `mergePreviewState` 纯函数 | 前端状态可用 | P1 |
| **P3 表格** | `FileTable` 新增两列 + 状态徽标 + 列宽调整 | 可视化 | P2 |
| **P4 操作** | 工具栏拆分 + `PreviewDraftDialog` + 行内操作 + 发布校验 | 完整功能 | P3 |
| **P5 加固** | 陈旧响应守卫、并发锁、失败重试、测试 | 生产就绪 | P4 |

### 7.2 需要同步修改的既有代码

**这是本次设计的风险集中点**，逐项列出：

| 文件 | 修改点 | 原因 | 回归风险 |
|------|-------|------|---------|
| `buffer.service.ts` | **无需修改** | 已实证：`.json` 后缀被 `pathFromKey` 的 `.buf` 检查天然排除 | 无 |
| `DraftsPage.tsx:148-217` | `handlePublish` 增加预发布校验 + 清理记录 | 强制流程落地 | 中 |
| `DraftsPage.tsx:64` | 移除 `publishTargets` useState，改由 previews 提供 | 统一数据源 | 中 —— 需确认所有引用点 |
| `FileTable.tsx:73-76,100-116` | 新增列 + 列宽参数化 | 表格扩展 | 低 —— 组件已参数化 |
| `DraftsPage.tsx:625-628` | 传新的列宽参数 | 配合表格 | 低 |
| `BufferContext.tsx` | 可能需暴露 previews（若选择集成进 Context 而非独立 hook） | 状态管理 | 中 |

**关于 `pathFromKey` 的结论修正**：设计初稿曾判断"必须在 `pathFromKey` 加 `.preview/` 过滤，否则记录会被写进 commit"，经**实测代码验证该判断不成立** —— `pathFromKey` 的 `.buf` 后缀检查已天然免疫 `.json` 记录。这条风险的真正形态是**命名约定风险**：只要坚持 `.json` 后缀就是安全的，误改为 `.buf` 才会出问题。

**建议的防御措施**：补一个单元测试锁定"`.preview/` 下的 `.json` key 不被 `pathFromKey` 接受"，把这个隐性约定显性化。测试成本极低（`path.test.ts` 已有现成范式），收益是防止未来的无意破坏。

### 7.3 建议的验证方式

| 验证项 | 方式 |
|--------|------|
| `pathFromKey` 的 `.preview/` 过滤 | 单元测试（`path.test.ts` 同目录新增），构造含 `.preview/` 的 key 列表，断言被排除 |
| 状态判定的纯函数 | 单元测试：覆盖 5 种状态的所有输入组合 |
| 预发布→发布全流程 | 手动验证（需真实 S3 + GitHub 仓库） |
| `.preview/` 不进 commit | 手动验证：预发布后执行发布，检查 commit 的文件清单 |
| 强制预发布的 UI 拦截 | 手动验证：未预发布时点发布，确认按钮禁用 |

---

## 8. 设计中的取舍与遗留问题

### 8.1 明确的设计取舍

| 取舍点 | 选择 | 放弃的替代方案 | 理由 |
|--------|------|--------------|------|
| 预发布是否产生真实预览 | **不产生** | 分支部署 / Worker 渲染端点 | 需求方明确要求"仅标记状态"；避免预览环境的运维成本 |
| 状态存储位置 | S3 独立命名空间 | 配置文件 / D1 表 / front-matter | 复用既有 S3 基础设施；不污染 front-matter；不引入双写一致性 |
| 状态数量 | 5 个（含 `preview-stale`） | 需求中的 4 个 | 防止"预发布后内容已变但状态显示正常"的误导 |
| 批量预发布的失败语义 | 部分成功 | 全成或全败 | 幂等的元数据写入，部分成功对用户更友好 |
| 工具栏按钮顺序 | 发布 → 预发布 | 预发布 → 发布（流程序） | 保持视觉权重与现有习惯 |

### 8.2 遗留问题（需后续决策）

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| Q1 | 预发布记录是否需要过期清理？ | S3 对象会累积 | 建议保留（记录很小），或加 90 天清理策略与 `webhook_events` 一致 |
| Q2 | 草稿被移入回收站时，预发布记录是否同步删除？ | 记录残留 | 建议删除（在 `handleDelete` 中一并处理） |
| Q3 | 仓库草稿的 `sha` 在首次扫描时为 `''` 怎么判定 stale？ | 可能误判 | 建议：`sha` 为空时退化用 `savedAt` 比对 |
| Q4 | 多设备并发预发布同一草稿？ | 后写覆盖 | 建议用 `previewedAt` 做乐观锁，旧时间戳的写入被拒绝 |
| Q5 | 是否需要在草稿箱显示"预发布人"？ | 多设备场景 | 记录中已存 `previewedBy`，UI 上可后续按需展示 |

### 8.3 与既有架构约定的一致性检查

按 `AGENTS.md` 的约定逐项核对：

| 约定 | 本设计是否符合 | 说明 |
|------|--------------|------|
| 最新值 ref 模式 | ✅ 遵循 | `useDraftPreviews` 中的回调按该模式处理 |
| 异步加载的陈旧响应防护 | ✅ 遵循 | 明确要求加 `cancelled` 标志 |
| Context value 稳定性 | ✅ 遵循 | 若集成 Context，value 用 `useMemo` |
| 管理接口授权 | ✅ 遵循 | 新端点用 `requireAuth`（非 admin 面） |
| 存储读取的结构校验 | ⚠️ **需注意** | 从 S3 读的 JSON 是自写的，风险较低；但 `DraftPreviewRecord` 的 `version` 字段应校验（参照 `repoConfigSync.ts:34` 的版本检查） |
| 并发控制 | ✅ 遵循 | 批量操作复用 `mapLimit` |
| 错误消息与状态码 | ✅ 遵循 | 前端用 `HttpError.status` 判断，不用文本匹配 |
| 渲染一致性 | ➖ 不涉及 | 本功能不产生 Markdown 渲染 |

---

## 9. 附：界面示意图

### 9.1 草稿箱完整布局（含新增列与按钮）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Bloath / 草稿箱                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  🔍 搜索草稿...                                                           │
│                                                                          │
│  已选 2 篇 │ 全选 │ [发布] [预发布] │ 移动 │ 删除 │ 重命名                  │
│                     ↑      ↑                                             │
│                  主按钮  次要按钮                                          │
│                                                                          │
│  ┌──┬────────────┬──────────────┬──────────────┬──────┬────────┬──────┐ │
│  │☑ │ 文件名      │ 路径          │ 预发布路径    │ 来源 │ 状态    │ 操作  │ │
│  ├──┼────────────┼──────────────┼──────────────┼──────┼────────┼──────┤ │
│  │☑ │ 测试文章    │ .draft/xxx.md│ content/posts│ 缓存 │已预发布 │编辑🗑│ │
│  │  │            │              │              │      │  (蓝)  │      │ │
│  ├──┼────────────┼──────────────┼──────────────┼──────┼────────┼──────┤ │
│  │☑ │ 三无        │ .draft/三无.md│ content/posts│ 仓库 │预发布  │编辑🗑│ │
│  │  │            │              │      ⚠️       │      │ 过期   │      │ │
│  │  │            │              │              │      │ (琥珀) │      │ │
│  ├──┼────────────┼──────────────┼──────────────┼──────┼────────┼──────┤ │
│  │☐ │ 模板        │ .draft/T.md  │      —       │ 仓库 │ 草稿   │编辑🗑│ │
│  │  │            │              │              │      │ (灰)   │      │ │
│  └──┴────────────┴──────────────┴──────────────┴──────┴────────┴──────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### 9.2 预发布对话框

```
┌─────────────────────────────────────────────┐
│  预发布 2 篇草稿                              │
│                                             │
│  预发布仅标记目标位置，不会产生提交；          │
│  确认后需再点「发布」才会移至目标目录。        │
│  ─────────────────────────────────────────  │
│  [ 统一目标 ] [ 逐篇指定 ]                    │
│                                             │
│  目标目录：                                  │
│  ┌───────────────────────────────────────┐  │
│  │ content/posts                      ⌄  │  │
│  └───────────────────────────────────────┘  │
│  留空将无法预发布                          │
│  ─────────────────────────────────────────  │
│                        [ 取消 ] [ 确认预发布 ]│
└─────────────────────────────────────────────┘
```

### 9.3 发布被拦截时的提示

```
┌─────────────────────────────────────────────┐
│  已选 3 篇 │ 全选 │ [发布] [预发布] │ ...     │
│                     ↑                       │
│                 置灰禁用                     │
│                     │                       │
│        ┌────────────▼──────────────────┐    │
│        │ 有 1 篇尚未预发布，请先预发布  │    │
│        └───────────────────────────────┘    │
└─────────────────────────────────────────────┘
        （tooltip，悬浮时显示）
```

---

## 10. 设计要点总结

**核心机制**：预发布 = 把"这篇草稿要发到哪个目录"这一意图**持久化到 S3**，并作为发布的前置关卡。

**三个关键设计决策**：

1. **存储复用而非新建** —— 用 S3 的 `.preview/` 独立前缀，复用既有 `s3.client` 与 `bufferConfig`，不引入配置文件、不新建 D1 表、不污染 front-matter。既满足了持久化需求，又保持与缓冲层机制的对称性好。

2. **增加 `preview-stale` 状态** —— 需求列了 4 个状态，设计扩展到 5 个。理由：预发布后编辑内容会让原目标失效，若不区分，用户会以为"已预发布"的路径仍然准确。

3. **`.json` 后缀是隐性契约** —— 预发布记录与缓冲条目共享同一个 S3 前缀树。设计初稿误判为"需要给 `pathFromKey` 加过滤代码"，实测后发现 `pathFromKey` 的 `.buf` 后缀检查已天然排除 `.json` 记录，**无需改一行既有代码**。但这使 `.json` 后缀从"命名习惯"升级为"必须遵守的契约"—— 一旦有人改成 `.buf`，记录会被当作待发布文件写进 commit。建议用单元测试把这个隐性约定显性化。

**待您决策的开放项**：第 8.2 节的 5 个遗留问题（清理策略、回收站联动、sha 空值、并发、展示）。
