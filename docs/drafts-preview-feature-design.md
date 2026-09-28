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
| 正式发布是否必经预发布 | **强制** —— 未预发布不能发布 | 预发布成为发布前的确认关卡，有/无 S3 一致 |
| 预发布路径来源 | **用户指定**预发布目录 | 与现有 `publishTargets` 机制同源 |
| 能否取消预发布 | **支持**，回到未发布态 | 非单向流程 |
| 状态存储 | **浏览器 localStorage**，按 `owner_repo_branch` 隔离 | **与 S3、git 完全解耦**，有无 S3 行为一致 |
| 多设备同步 | **不需要** | 预发布是本机操作意图，非跨设备协作文档 |
| 键是否含 branch | **含**（`{owner}_{repo}_{branch}`） | 避免跨分支误判（同类问题见审查报告 M-R4） |
| 孤立记录清理 | **自动清理** | 列表渲染时忽略无对应草稿的记录 |

### 1.2.1 存储选型的演进（设计过程中的一次修正）

设计初稿把预发布状态存放在 **S3 缓冲层**（复用 `s3.client` 与 `bufferConfig`）。经需求方质疑"如果没有接入 S3，预发布该怎么办"后核实发现：

`BufferContext.tsx:50` 在缓冲层关闭时会清空 `changes`，`DraftsPage.tsx:88` 也随之退化为"纯仓库文件列表"。此时：

- 我的初稿方案**完全不可用**（无 S3 即无存储）
- 叠加"强制预发布才能发布"的规则，会导致**无 S3 环境下用户连发布都做不了** —— 功能死锁

**改用 localStorage 后，上述问题全部消失**，且带来额外收益：

| 维度 | S3 方案（初稿） | localStorage 方案（定稿） |
|------|---------------|------------------------|
| 有无 S3 的行为 | **不一致**（无 S3 时不可用） | **完全一致** |
| 实现复杂度 | 需 4 个后端端点 + service + 类型 | **零后端改动** |
| 写操作开销 | 每次预发布一次 S3 写 | 本地写入，无网络 |
| 离线可用 | 否 | **是** |
| 多设备同步 | 支持 | 不支持（需求确认**不要求**） |
| 状态与仓库内容一致性 | 强（服务端权威） | 弱（以本地文件 sha 比对检测变更） |

**结论：需求方"状态存浏览器、仅本机即可"的选择，使方案在复杂度与一致性之间取得了更好的平衡。** 唯一代价是失去多设备同步，而这恰是需求明确不要求的。

### 1.3 设计范围边界（本次不做）

明确排除，避免范围蔓延：

- 不实现真实的预览渲染（不做 draft 站点、不做临时域名）
- 不实现定时发布 / 预约发布
- 不实现多人协作与审批流
- 不改变现有的 git commit 与 CI 触发策略（`deploySettings.ts` 保持原样）
- **不引入后端改动**（存储方案改为 localStorage 后，无需新端点、新表、新配置文件）
- **不做多设备同步**（需求明确不要求；预发布状态是本机操作意图）

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
| localStorage 读写范式 | `lib/profileService.ts:15-37` | **主要参照对象**：按仓库存元数据的键构造、容错读、手动覆盖清除 |
| 键前缀常量约定 | `lib/constants.ts:9` 的 `UNDO_STORAGE_PREFIX` | 新增 `PREVIEW_KEY_PREFIX` 时遵循 |
| 目录树选择器 | `components/drafts/DirectoryTreePicker.tsx` | 预发布目标选择的 UI 复用 |
| 对话框交互范式 | `components/drafts/PublishDraftDialog.tsx` | `PreviewDraftDialog` 的结构参照 |
| 动作锁防重 | `DraftsPage.tsx:70-84` 的 `acquireActionLock` | 批量预发布时复用 |
| 表格列参数化 | `components/FileTable.tsx:37-40` | 新增列无需改表格结构 |

> **注**：初稿此表列出的是 `s3.client` / `bufferConfig` / `mapLimit` 等服务端能力。改用 localStorage 后，可复用的对象全部转为前端既有的本地存储与 UI 范式。

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

### 4.1 存储方案：浏览器 localStorage

**完全不依赖 S3、不依赖 git、不改后端** —— 这是本方案最重要的特性。

```
localStorage 键结构：

bloath_previews_{owner}_{repo}_{branch}
     └──────┬──────┘ └────────┬────────┘
      前缀常量          仓库 + 分支隔离

值结构（JSON）：
{
  "version": 1,
  "records": {
    ".draft/20260928-测试文章.md": {
      "previewTarget": "content/posts",
      "contentSha": "a1b2c3...",
      "savedAt": 1790574265999,
      "previewedAt": 1790574265999
    },
    ".draft/三无.md": { ... }
  }
}
```

**键的粒度选择**：

| 粒度 | 键 | 取舍 |
|------|-----|------|
| 每仓库一个键 | `bloath_previews_{owner}_{repo}_{branch}` | ✅ 一次读写全部记录；✅ 与 `profileService.ts:16` 的既有粒度一致；❌ 记录多时单值较大（但草稿量通常 <100，JSON 约 10KB 量级，远低于 localStorage 5MB 上限） |
| 每草稿一个键 | `bloath_preview_{owner}_{repo}_{branch}_{path}` | ✅ 单条读写；❌ 需列举全部键（localStorage 无前缀查询，须遍历 `key(i)`）；❌ 键数量膨胀 |

**选每仓库一个键**，理由：与项目既有的 `profileService` 粒度一致；避免遍历；单值体量可控。

**为何不用 S3**（初稿方案的废弃原因）见 1.2.1 节。核心原因：S3 是可选的，无 S3 时初稿方案完全不可用，且会因"强制预发布"导致发布功能死锁。

**为何不用 git / 配置文件**：

| 方案 | 问题 |
|------|------|
| `.bloath/config.json` | `pushRepoConfig`（`repoConfigSync.ts:45-69`）**整体覆盖文件**，而该文件由 `MainLayout.tsx:407-432` 的自动拉取 + 设置页手动推送共同维护 → 预发布写入会被后续的配置推送**静默覆盖** |
| 草稿旁标记文件 | 仓库中产生非常规文件（`.draft/xxx.md.preview`），可能被内容同步机制误处理 |
| front-matter | 污染文章元数据；Hugo/Jekyll 会把自定义字段当文章属性；改目标需写文件内容 |

### 4.2 数据结构

```typescript
// web/src/lib/draftPreviewStore.ts（前端专用，无需放 shared/）

/** 草稿的预发布状态 */
export type DraftPreviewState = 'draft' | 'previewed' | 'preview-stale';

/** 单条预发布记录 */
export interface DraftPreviewRecord {
  /** 预发布目标目录，如 content/posts */
  previewTarget: string;
  /** 预发布时的内容 SHA（git blob sha），用于检测预发布后内容是否变化 */
  contentSha: string;
  /**
   * 预发布时的 savedAt 兜底值。
   * 新建的缓冲项 sha 为 ''（draftMerge.ts:61），无法用 sha 检测变化，
   * 此时退回比对 savedAt。
   */
  savedAt?: number;
  /** 预发布操作时间戳 */
  previewedAt: number;
}

/** localStorage 中的完整存储结构 */
export interface DraftPreviewStore {
  /** 数据格式版本，便于后续演进（参照 repoConfigSync.ts:34 的版本检查做法） */
  version: 1;
  /** 草稿路径 → 预发布记录 */
  records: Record<string, DraftPreviewRecord>;
}
```

**字段设计说明**：

- **不放 `version` 到单条记录**：版本属于整个存储结构，放顶层即可（初稿放在每条记录里是冗余）
- **去掉 `previewedBy`**：多设备同步已确认不需要，记录操作者无消费方
- **`savedAt` 可选**：仅 sha 为空的条目需要

### 4.3 内容变更检测

用**草稿文件的 git blob sha**（`EnhancedFileItem.sha`）作为变更依据：

| 草稿类型 | sha 来源 | 可用性 |
|---------|---------|--------|
| 仓库草稿（`repo`） | `scanner.ts` → `getTree` 提供 | ✅ 始终有值 |
| 缓冲项（`buffer-modified`） | `draftMerge.ts:46` 的 `prev?.sha` | ✅ 取仓库侧 sha |
| 新建缓冲项（`buffer`） | `draftMerge.ts:61` 硬编码 `''` | ❌ 空值 |

**空 sha 的处理**：存入记录的 `contentSha` 为 `''`，同时写入 `savedAt`。状态判定时：

```typescript
function isStale(record: DraftPreviewRecord, item: EnhancedFileItem): boolean {
  // sha 可用时以 sha 为准
  if (record.contentSha && item.sha) {
    return record.contentSha !== item.sha;
  }
  // sha 缺失时退回比对 savedAt（缓冲项的 savedAt 随每次写入更新）
  if (record.savedAt !== undefined && item.lastModified !== undefined) {
    return item.lastModified > record.savedAt;
  }
  // 两者都不可用：保守判为未过期（避免误报 stale 打断用户流程）
  return false;
}
```

**保守判定的理由**：`preview-stale` 的作用是提醒，误报（把未变化的判为过期）会让用户做无谓的重新预发布；漏报（把已变化的判为正常）的后果由发布时的二次确认兜住。两害相权，倾向保守。

### 4.4 按仓库+分支隔离

```typescript
const PREVIEW_KEY_PREFIX = 'bloath_previews_';

function previewStorageKey(repo: { owner: string; repo: string; branch?: string }): string {
  return `${PREVIEW_KEY_PREFIX}${repo.owner}_${repo.repo}_${repo.branch || 'main'}`;
}
```

**必须含 branch** —— 这是从审查报告 M-R4 学到的教训：

> M-R4 的缺陷正是"撤销键不含 branch，切换分支后在错误的分支上执行操作"。若预发布的键不含 branch，用户在 `main` 预发布了 `.draft/x.md`，切到 `dev` 分支后同路径草稿会**错误显示为已预发布**，而它实际从未在本分支预发布过。

同理，切换仓库（owner/repo 变化）也天然隔离。

### 4.5 孤立记录清理

草稿在仓库侧被删除或移入回收站后，本地记录会成为孤立项。**采用"惰性清理 + 定期清扫"**：

```typescript
/** 惰性清理：列表加载时，丢弃无对应草稿的记录（不写回，避免渲染期写存储） */
function pruneOrphans(
  records: Record<string, DraftPreviewRecord>,
  liveDraftPaths: Set<string>
): Record<string, DraftPreviewRecord> {
  const next: Record<string, DraftPreviewRecord> = {};
  for (const [path, rec] of Object.entries(records)) {
    if (liveDraftPaths.has(path)) next[path] = rec;
  }
  return next;
}
```

**两段式处理的理由**：

| 时机 | 动作 | 原因 |
|------|------|------|
| 列表渲染 | 仅**忽略**孤立记录（内存中过滤） | 渲染期不应写 localStorage（副作用）；且草稿可能只是暂时加载失败 |
| 显式操作后 | **写回**清理结果（如发布/删除成功后） | 此时能确认草稿确实已离开草稿箱 |

**不采用"立即删除"**：草稿可能因为网络抖动、扫描失败而暂时不在列表中，立即删除会导致预发布状态意外丢失。

---

## 5. 前端模块设计（原"后端 API 设计"章节）

> **本章已随存储方案变更而重写。** 初稿设计了 4 个后端端点，改用 localStorage 后**后端零改动**，设计重心转移到前端模块。

### 5.1 模块清单

| 模块 | 类型 | 职责 |
|------|------|------|
| `web/src/lib/draftPreviewStore.ts` | 纯逻辑 | localStorage 读写、键构造、孤立清理、状态判定 |
| `web/src/hooks/useDraftPreviews.ts` | React hook | 封装 store，提供响应式状态与操作方法 |
| `web/src/lib/draftPreviewMerge.ts` | 纯函数 | 把预发布状态叠加到草稿列表项上 |

**无新增后端代码** —— 这是存储方案变更带来的最大简化。

### 5.2 `draftPreviewStore.ts` 接口

```typescript
/** 读取某仓库+分支的全部预发布记录（容错：解析失败返回空） */
export function readPreviewStore(repo: RepoInfo): DraftPreviewStore;

/** 写入单条预发布记录，返回写入后的完整 store */
export function writePreviewRecord(
  repo: RepoInfo,
  path: string,
  record: DraftPreviewRecord
): DraftPreviewStore;

/** 删除单条记录 */
export function removePreviewRecord(repo: RepoInfo, path: string): DraftPreviewStore;

/** 批量写入（多选预发布场景） */
export function writePreviewRecords(
  repo: RepoInfo,
  entries: Array<{ path: string; record: DraftPreviewRecord }>
): DraftPreviewStore;

/** 清理孤立记录并写回 */
export function pruneAndPersist(repo: RepoInfo, livePaths: Set<string>): DraftPreviewStore;

/** 判定单条草稿的预发布状态 */
export function resolvePreviewState(
  record: DraftPreviewRecord | undefined,
  item: EnhancedFileItem
): DraftPreviewState;
```

**容错要求**（对齐项目既有做法）：

- 所有 `localStorage` 操作包 `try/catch`（隐私模式/配额满时降级为空 store，不抛错）
- JSON 解析失败时返回空 store 并 `console.warn`，不阻断页面
- 校验 `version === 1`，不匹配时返回空 store（参照 `repoConfigSync.ts:34`）

### 5.3 状态判定的纯函数

```typescript
export function resolvePreviewState(
  record: DraftPreviewRecord | undefined,
  item: EnhancedFileItem
): DraftPreviewState {
  if (!record) return 'draft';
  return isStale(record, item) ? 'preview-stale' : 'previewed';
}
```

**纯函数化的价值**：这是本功能唯一有分支判断的逻辑，抽成纯函数后可**独立单元测试**，无需挂载 React 组件（对齐项目 `path.ts`、`frontmatter.ts` 的既有测试范式）。

**单元测试要点**（新增 `web/src/lib/draftPreviewStore.test.ts`）：

| 用例 | 输入 | 期望 |
|------|------|------|
| 无记录 | `record = undefined` | `'draft'` |
| sha 一致 | `record.contentSha === item.sha` | `'previewed'` |
| sha 变化 | `record.contentSha !== item.sha` | `'preview-stale'` |
| sha 为空且 savedAt 更新 | `contentSha=''`，`item.lastModified > record.savedAt` | `'preview-stale'` |
| sha 为空且 savedAt 未变 | `contentSha=''`，`item.lastModified <= record.savedAt` | `'previewed'` |
| 两者都不可用 | 无 sha 且无 savedAt | `'previewed'`（保守） |

> **测试命令注意**：`web/package.json:11` 的测试命令**显式列举文件路径**，新增测试文件必须手动加入该命令行，否则不会被执行。（该约束来自审查报告第 15.3 节的 N-2）

---

## 6. 界面设计

> 本章覆盖需求 R1（预发布路径列）、R2（按钮拆分）、R6（界面布局与交互）。

### 6.1 数据流改造

```
┌──────────────────────────────────────────────────────────────┐
│ DraftsPage.tsx                                               │
│                                                              │
│  useFileListPage ──► files（仓库草稿）                        │
│  useBuffer ───────► changes（S3 缓冲清单，可为空）             │
│  useDraftPreviews ─► previews（localStorage 预发布记录）🆕      │
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

**关键点：预发布状态与缓冲层并行、互不依赖。**

`useDraftPreviews` 的数据源是 localStorage，`useBuffer` 的数据源是 S3。两者独立工作：

| 场景 | 缓冲层 | 预发布 |
|------|-------|--------|
| 有 S3 | 正常工作 | 正常工作 |
| **无 S3** | `changes` 为空数组 | **仍正常工作**（localStorage 与 S3 无关） |

这是改用 localStorage 后获得的核心收益 —— 预发布功能**在有/无 S3 两种环境下行为完全一致**。

**`useDraftPreviews` hook**（新文件 `web/src/hooks/useDraftPreviews.ts`）：

- 参照 `BufferContext` 的实现范式（`useMemo` 包装 value、`useCallback` 包裹方法）
- 方法：`previews`、`setPreview`、`cancelPreview`、`batchPreview`、`recancelPreview`
- **不依赖缓冲配置**：`useEffect` 依赖仅 `[selectedRepo]`（初稿曾依赖 `config?.enabled`，改用 localStorage 后该依赖不再必要）
- localStorage 读取是**同步**的，无需陈旧响应守卫（与网络请求不同）
- 但需在 `selectedRepo` 变化时**重新读取**对应键的记录

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
               └─► writePreviewRecord(repo, path, {...})   ← 写 localStorage
                   └─► 状态变为「已预发布」，列显示 content/posts
                       └─► Toast: 已标记预发布目标：content/posts

2. 用户点击「发布」
   └─► 校验通过（已预发布）
       └─► commitBatch，move 到 content/posts
           └─► removePreviewRecord(repo, path)             ← 清理记录
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
1. 已预发布项，行内操作区显示「取消预发布」
2. 点击 → removePreviewRecord(repo, path)   ← 删 localStorage 记录
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

改用 localStorage 后，**实施阶段从 5 个缩减为 4 个，且无后端依赖**：

| 阶段 | 内容 | 交付物 | 依赖 | 预估 |
|------|------|--------|------|------|
| **P1 存储层** | `draftPreviewStore.ts`（读写/键构造/清理/状态判定）+ 单元测试 | 可独立验证的纯逻辑 | 无 | 小 |
| **P2 状态层** | `useDraftPreviews` hook + `EnhancedFileItem` 加 `previewState` 字段 | 前端状态可用 | P1 | 小 |
| **P3 表格** | `FileTable` 新增「预发布路径」列 + 状态徽标 + 列宽调整 | 可视化 | P2 | 中 |
| **P4 操作** | 工具栏拆分（发布/预发布）+ `PreviewDraftDialog` + 行内操作 + 发布校验 | 完整功能 | P3 | 中 |

**相比初稿的变化**：删除原 P1（后端 service + 4 端点）与 P5（陈旧响应守卫 —— localStorage 同步读取无需该防护）。

### 7.2 需要同步修改的既有代码

| 文件 | 修改点 | 原因 | 回归风险 |
|------|-------|------|---------|
| **无后端改动** | — | localStorage 方案下后端完全不涉及 | 无 |
| `DraftsPage.tsx:148-217` | `handlePublish` 增加预发布校验 + 发布后清理记录 | 强制流程落地 | 中 |
| `DraftsPage.tsx:64` | **移除 `publishTargets` useState**，改由 previews 提供 | 统一数据源（消除"发布对话框临时选目标"与"预发布锁定目标"的双轨） | **中** —— 需确认 3 处引用点（`:163`、`:189`、`:700`） |
| `DraftsPage.tsx:625-628` | 传新的列宽参数 | 配合表格 | 低 |
| `FileTable.tsx:73-76,100-116` | 新增列 + 列宽参数化 | 表格扩展 | 低 —— 组件已参数化 |
| `extractFrontMatter.ts:13-28` | `EnhancedFileItem` 增加 `previewState?` 字段 | 类型承载 | 低 —— 纯增量字段 |

**关于移除 `publishTargets` 的影响**：这是本次改动中风险最高的一处，因为它改变了现有交互。

现有流程（`DraftsPage.tsx:700`）：点「发布」→ 弹 `PublishDraftDialog` → 选目标 → 确认。
新流程：点「预发布」→ 弹 `PreviewDraftDialog` → 选目标 → 确认（写入 localStorage）→ 点「发布」（目标已确定，无需再选）。

**`PublishDraftDialog` 的去留需要决策**：

| 选项 | 说明 |
|------|------|
| A. 保留但只读 | 发布时弹窗展示已预发布的目标，仅作确认，不可改（要改先去预发布） |
| B. 保留且可改 | 发布时仍可改目标，相当于"一步完成预发布+发布"（但削弱了强制预发布的意义） |
| C. 移除 | 发布直接执行，无弹窗（目标来自预发布记录） |

**建议 A** —— 保留视觉确认环节（用户能看到"要发到哪"），同时强制流程不被绕过。选项 B 会让强制预发布形同虚设；选项 C 缺少最后确认，风险偏高。

### 7.3 建议的验证方式

| 验证项 | 方式 | 说明 |
|--------|------|------|
| `resolvePreviewState` 的状态判定 | **单元测试** | 覆盖 4.3 节的 6 个用例；纯函数无需挂载组件 |
| `isStale` 的 sha 缺失分支 | **单元测试** | 专测缓冲项 sha 为空时的 savedAt 兜底逻辑 |
| 键的仓库+分支隔离 | **单元测试** | 构造不同 owner/repo/branch，断言键不同 |
| localStorage 容错 | **单元测试** | 注入损坏 JSON、`version` 不匹配、`setItem` 抛异常（Mock 配额满），断言降级为空 store 且不抛错 |
| 孤立记录清理 | **单元测试** | 传入含孤立项的 records 与 livePaths，断言过滤结果 |
| 无 S3 环境完整流程 | **手动验证** | 关闭缓冲层（删除 `buffer_config`）后走一遍预发布→发布 |
| 有 S3 环境完整流程 | **手动验证** | 开启缓冲层，验证缓冲项也能预发布 |
| 强制预发布的 UI 拦截 | **手动验证** | 未预发布时点发布，确认按钮禁用且有提示 |
| 跨分支不串状态 | **手动验证** | 在 main 预发布，切到 dev 确认显示为未预发布 |

> **测试命令注意**：新增测试文件须手动加入 `web/package.json:11` 的命令行（该命令显式列举文件路径）。

---

## 8. 设计中的取舍与遗留问题

### 8.1 明确的设计取舍

| 取舍点 | 选择 | 放弃的替代方案 | 理由 |
|--------|------|--------------|------|
| 预发布是否产生真实预览 | **不产生** | 分支部署 / Worker 渲染端点 | 需求方明确要求"仅标记状态"；避免预览环境的运维成本 |
| **状态存储位置** | **localStorage** | S3 / 配置文件 / D1 / front-matter | **有无 S3 行为一致**；零后端改动；离线可用；需求不要求多设备同步 |
| 状态数量 | 5 个（含 `preview-stale`） | 需求中的 4 个 | 防止"预发布后内容已变但状态显示正常"的误导 |
| 存储粒度 | 每仓库+分支一个键 | 每草稿一个键 | 与 `profileService.ts:16` 的既有粒度一致；避免遍历键 |
| 孤立记录处理 | 惰性忽略 + 操作时写回 | 立即删除 | 草稿可能因网络抖动暂时不在列表中，立即删会误丢状态 |
| 工具栏按钮顺序 | 发布 → 预发布 | 预发布 → 发布（流程序） | 保持视觉权重与现有习惯 |
| 发布时是否可改目标 | **不可改**（需先取消预发布） | 弹窗内可改 | 改目标会绕过"强制预发布"的设计意图 |

### 8.2 遗留问题（需后续决策）

**相比初稿的变化**：初稿的 Q1（S3 清理）、Q4（多设备并发）、Q5（预发布人展示）因改用 localStorage 与"不要求多设备同步"而**自动消解**。

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| Q1' | localStorage 被清空（用户清缓存/换浏览器）后预发布状态丢失 | 用户需重新预发布 | **接受**（需求确认不需要多设备同步）。可在 UI 上弱提示"预发布状态仅保存于本机" |
| Q2 | 草稿移入回收站后，本地记录残留 | 记录成为孤立项 | 惰性清理已覆盖（4.5 节）；建议在 `handleDelete` 成功后主动 `pruneAndPersist` |
| Q3 | 缓冲项 `sha` 为空时无法用 sha 检测变化 | 可能漏判 stale | 已设计 `savedAt` 兜底（4.3 节） |
| Q4 | `PublishDraftDialog` 的去留 | 影响交互改动面 | 建议选项 A（保留作只读确认）—— 见 7.2 节 |
| Q5 | 同一浏览器多标签页同时操作 | 后写覆盖（localStorage 无锁） | 影响很低（单用户场景）。可用 `storage` 事件同步，属增强项 |

### 8.3 与既有架构约定的一致性检查

按 `AGENTS.md` 的约定逐项核对：

| 约定 | 本设计是否符合 | 说明 |
|------|--------------|------|
| 最新值 ref 模式 | ✅ 遵循 | `useDraftPreviews` 中的回调按该模式处理 |
| 异步加载的陈旧响应防护 | ➖ **不适用** | localStorage 读取是同步的，不存在陈旧响应问题（这是方案简化的一处体现） |
| Context value 稳定性 | ✅ 遵循 | 若集成 Context，value 用 `useMemo`、方法用 `useCallback` |
| 管理接口授权 | ➖ 不适用 | 无新增后端端点 |
| 存储读取的结构校验 | ✅ 遵循 | **本设计明确要求校验 `version` 字段**，并注入损坏 JSON 的容错测试（参照 `repoConfigSync.ts:34` 的版本检查做法） |
| 并发控制 | ✅ 遵循 | 批量预发布为本地同步操作，无需 `mapLimit`；发布走既有 `commitBatch` |
| 错误消息与状态码 | ➖ 不适用 | 无新增 HTTP 调用；localStorage 异常降级为空 store |
| 渲染一致性 | ➖ 不涉及 | 本功能不产生 Markdown 渲染 |

**新增需要遵守的约定**：`previewStorageKey` 必须包含 branch（4.4 节），这是从审查报告 M-R4 的缺陷中提炼的教训，建议在实现时补单元测试锁定。

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

**核心机制**：预发布 = 把"这篇草稿要发到哪个目录"这一意图**记在本机浏览器**，并作为发布的前置关卡。

**四个关键设计决策**：

1. **存储用 localStorage，与 S3/git 完全解耦** —— 这是设计过程中经过一次重要修正后的结论。初稿把状态放在 S3，未考虑"S3 是可选配置"这一事实：`BufferContext.tsx:50` 在缓冲层关闭时清空 `changes`，此时初稿方案不可用，叠加"强制预发布"规则会导致**无 S3 环境连发布都做不了**（功能死锁）。改用 localStorage 后，有无 S3 行为完全一致，且**零后端改动**。

2. **增加 `preview-stale` 状态** —— 需求列了 4 个状态，设计扩展到 5 个。理由：预发布后编辑内容会让原目标失效，若不区分，用户会以为"已预发布"的路径仍然准确。

3. **存储键必须含 branch** —— 这是从审查报告的 M-R4 缺陷中提炼的教训（该缺陷正是"撤销键不含 branch 导致跨分支误操作"）。不含 branch 会让 `main` 分支的预发布状态错误地显示在 `dev` 分支的同名草稿上。

4. **移除 `publishTargets`，消除双轨数据源** —— 现状是"仓库草稿的目标存 useState（刷新即丢）+ 缓冲项的目标存 S3"，两者机制不同。改用统一的 localStorage 后，`DraftsPage.tsx:64` 的临时状态可以删除，所有草稿类型共用一套目标存储。这是本次改动中**风险最高但收益也最高**的一处（消除了用户"每次发布都要重选目标"的痛点）。

**待决策的开放项**：第 8.2 节的 5 项，其中 Q4（`PublishDraftDialog` 去留）与 Q1'（本机状态丢失的提示）最需要确认。
