# 前端 Front Matter 元数据提取排序方案

## 一、方案概述

### 1.1 背景

当前文章列表排序依赖后端通过 GitHub Commits API 逐文件获取 `lastModified` 时间戳，存在以下问题：
- 每篇文章需额外调用 1 次 Commits API（N 篇文章 = 2N 次 API 调用）
- 后端需分批串行处理（batchSize=3），100 篇文章需 100+ 秒
- 排序依据是文件修改时间，而非文章发布日期（Front Matter `date`）

### 1.2 目标

**完全废弃 Commits API**，将排序数据获取迁移至前端，通过浏览器端并发读取 Markdown 文件的 Front Matter 元数据，提取 `date` 字段进行排序。

**核心收益：**
- API 调用量从 2N 降至 N+1（Trees 1 次 + 文件内容 N 次）
- 消除后端 Commits API 串行瓶颈，响应时间从 100s+ 降至 5-10s
- 使用 Front Matter `date` 字段排序，语义更准确（按文章发布日期而非文件修改时间）
- 减轻后端负载，Cloudflare Worker 不再需要批量调用 Commits API

### 1.3 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| Front Matter 解析 | `front-matter`（npm） | 生态最成熟，周下载 100万+，零依赖核心，~2KB |
| 并发控制 | 自定义 `batchFetch` 工具函数 | 浏览器端并发调整为 5，充分利用浏览器并行能力 |
| 排序逻辑 | 新增 `sortByFrontMatterDate()` | 仅使用 Front Matter `date` + 文件名降级，**废弃 Commits API** |
| 缓存 | 扩展现有 `fileCache.ts` | 复用 TTL 机制，延长至 10 分钟 |

---

## 二、架构设计

### 2.1 数据流

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  前端 React  │────>│  scanMdFiles()   │────>│  getTree() API  │
│  组件        │     │  (useFileList.ts)│     │  (1 次调用)     │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ extractFrontMatters() │
                    │ (新增模块)         │
                    │ - 并发读取 N 个文件 │
                    │ - 解析 Front Matter │
                    │ - 提取 date 字段   │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ sortByFrontMatterDate() │
                    │ (新增排序函数)     │
                    │ - 优先 date 排序  │
                    │ - 降级文件名时间  │
                    │ - **不再使用 Commits API** │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ 浏览器缓存        │
                    │ (fileCache.ts)   │
                    └──────────────────┘
```

### 2.2 废弃模块

以下后端代码将被废弃，不再维护：

| 文件 | 废弃函数 | 原因 |
|------|---------|------|
| `cloudflare-worker/src/github.ts` | `getFileLastModified()` | Commits API 串行调用性能差 |
| `cloudflare-worker/src/github.ts` | `extractTimestampFromFilename()` | 仅作为降级兜底，主流程废弃 |
| `cloudflare-worker/src/github.ts` | `getTree()` 中的 Commits 调用逻辑 | 整体迁移至前端 |

### 2.2 层级划分

| 层级 | 文件 | 职责 |
|------|------|------|
| **解析层** | `web/src/lib/extractFrontMatter.ts`（新增） | 并发读取文件、解析 Front Matter、提取元数据 |
| **排序层** | `web/src/lib/sortFiles.ts`（新增函数） | 新增 `sortByFrontMatterDate()`，**废弃 Commits API 依赖** |
| **数据层** | `web/src/hooks/useFileList.ts`（修改） | 调用新的 Front Matter 提取流程 |
| **缓存层** | `web/src/lib/fileCache.ts`（扩展） | 增加 frontmatter 缓存字段 |
| **类型层** | `shared/types.ts`（扩展） | 增加 `EnhancedFileItem` 类型 |
| **废弃层** | `cloudflare-worker/src/github.ts` | 废弃 `getFileLastModified()` 和 Commits 调用逻辑 |

---

## 三、详细设计

### 3.1 新增模块：`extractFrontMatter.ts`

**文件路径**: `web/src/lib/extractFrontMatter.ts`

#### 3.1.1 核心函数签名

```typescript
/**
 * 从文件路径列表并发提取 Front Matter 元数据
 * 
 * @param files - 文件列表（来自 getTree）
 * @param repoInfo - 仓库信息
 * @param options - 配置项
 * @returns 带 frontmatter 的文件列表
 */
export async function extractFrontMatters(
  files: FileItem[],
  repoInfo: RepoInfo,
  options?: {
    /** 并发批次大小，默认 5 */
    batchSize?: number;
    /** 单文件读取超时，默认 8000ms */
    timeoutMs?: number;
    /** 最大重试次数，默认 2 */
    maxRetries?: number;
  }
): Promise<EnhancedFileItem[]>;
```

#### 3.1.2 EnhancedFileItem 类型

```typescript
export interface EnhancedFileItem extends FileItem {
  /** 从 Front Matter 解析的元数据 */
  frontmatter?: {
    title?: string;
    date?: string;        // ISO 8601 格式
    author?: string;
    tags?: string[];
    categories?: string[];
  };
  /** 解析后的日期时间戳（用于排序） */
  sortDate?: number;
}
```

#### 3.1.3 读取单个文件 Front Matter

```typescript
/**
 * 读取单个 Markdown 文件并提取 Front Matter
 * 使用 GitHub Contents API（base64 编码）
 * 
 * 策略：只读取文件前 N 行（Front Matter 通常在 50 行以内）
 * 通过 GitHub API 的 range header 或截断响应优化带宽
 */
async function readSingleFrontmatter(
  file: FileItem,
  repoInfo: RepoInfo,
  retries: number = 0
): Promise<EnhancedFileItem> {
  try {
    // 调用后端代理读取文件内容
    const { content } = await readFile({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      path: file.path,
      branch: repoInfo.branch
    });

    // 提取前 1024 字符（足够覆盖绝大多数 Front Matter）
    const header = content.slice(0, 1024);
    
    // 使用 front-matter 库解析
    const result = front(header);
    
    return {
      ...file,
      frontmatter: result.attributes as ArticleFrontmatter,
      sortDate: parseDateToTimestamp(result.attributes?.date)
    };
  } catch (err) {
    if (retries < 2) {
      await delay(500 * (retries + 1)); // 指数退避
      return readSingleFrontmatter(file, repoInfo, retries + 1);
    }
    // 失败时返回原文件（不带 frontmatter）
    return file as EnhancedFileItem;
  }
}
```

#### 3.1.4 并发控制

```typescript
/**
 * 分批并发读取 Front Matter
 * 参考后端 batchSize=3 策略，前端调整为 5（浏览器并发能力更强）
 */
async function batchFetch(
  files: EnhancedFileItem[],
  repoInfo: RepoInfo,
  batchSize: number = 5
): Promise<EnhancedFileItem[]> {
  const results: EnhancedFileItem[] = [...files];
  
  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (file, idx) => {
        const result = await readSingleFrontmatter(file, repoInfo);
        results[i + idx] = result;
      })
    );
  }
  
  return results;
}
```

#### 3.1.5 日期解析工具

```typescript
/**
 * 将 Front Matter date 字段转换为时间戳
 * 支持格式：
 * - ISO 8601: "2026-07-07T12:00:00+08:00"
 * - 日期字符串: "2026-07-07"
 * - 时间戳: 1688774400000
 */
function parseDateToTimestamp(dateValue?: string | number | Date): number {
  if (!dateValue) return 0;
  
  if (typeof dateValue === 'number') return dateValue;
  if (typeof dateValue === 'string') {
    // 尝试直接解析
    const ts = new Date(dateValue).getTime();
    if (!isNaN(ts)) return ts;
  }
  
  return 0;
}
```

---

### 3.2 扩展模块：`sortFiles.ts`

**文件路径**: `web/src/lib/sortFiles.ts`

#### 3.2.1 新增排序函数

```typescript
/**
 * 按 Front Matter date 字段降序排序（最新在前）
 * 降级策略（不再使用 Commits API）：
 * 1. 优先使用 frontmatter.date
 * 2. 回退到文件名提取时间（YYYYMMDD 格式）
 */
export function sortByFrontMatterDate<T extends EnhancedSortableFile>(files: T[]): T[] {
  return files.sort((a, b) => {
    // 第一优先级：Front Matter date
    const dateA = a.sortDate || (a.frontmatter?.date ? parseDateToTimestamp(a.frontmatter.date) : 0);
    const dateB = b.sortDate || (b.frontmatter?.date ? parseDateToTimestamp(b.frontmatter.date) : 0);
    
    if (dateA !== dateB && dateA > 0 && dateB > 0) {
      return dateB - dateA;  // 降序
    }
    
    // 第二优先级：文件名提取时间（降级兜底）
    const timeA = extractTimestampFromFilename(a.name);
    const timeB = extractTimestampFromFilename(b.name);
    
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    
    return 0;
  });
}
```

#### 3.2.2 扩展接口

```typescript
export interface EnhancedSortableFile extends SortableFile {
  frontmatter?: {
    title?: string;
    date?: string;
  };
  sortDate?: number;
}
```

---

### 3.3 修改模块：`useFileList.ts`

**文件路径**: `web/src/hooks/useFileList.ts`

#### 3.3.1 scanMdFiles 增强

```typescript
export async function scanMdFiles(
  repo: RepoInfo,
  basePath: string
): Promise<EnhancedFileItem[]> {
  // 第一步：获取文件列表（不变）
  const allFiles = await getTree(repo);

  const normalizedBase = basePath.replace(/^\/+|\/+$/g, '');
  const mdFiles = allFiles
    .filter((item) => {
      if (!item.name.endsWith('.md')) return false;
      if (normalizedBase) {
        return item.path.startsWith(normalizedBase + '/') || item.path === normalizedBase;
      }
      return true;
    })
    .map((item) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      type: item.type as 'file',
      size: item.size,
      lastModified: item.lastModified
    }));

  // 第二步：并发提取 Front Matter（新增）
  const enhancedFiles = await extractFrontMatters(mdFiles, repo, {
    batchSize: 5,
    timeoutMs: 8000,
    maxRetries: 2
  });

  return enhancedFiles;
}
```

#### 3.3.2 useFileList Hook 修改

```typescript
export function useFileList(basePath: string, selectedRepo: RepoInfo | null, enabled: boolean) {
  // ... 现有状态不变
  
  const refresh = useCallback(async (silent = false) => {
    // ... 现有缓存逻辑不变
    
    try {
      const result = await scanMdFiles(selectedRepo, basePath);
      
      // 修改：使用新的排序函数
      sortByFrontMatterDate(result);
      
      // 缓存增强：存储 frontmatter 数据
      setCachedFiles(selectedRepo, basePath, result);
      setFiles(result);
    } catch (err) {
      // ... 现有错误处理
    }
  }, [basePath, selectedRepo, enabled]);
  
  // ...
}
```

---

### 3.4 扩展模块：`fileCache.ts`

**文件路径**: `web/src/lib/fileCache.ts`

#### 3.4.1 缓存结构增强

```typescript
interface CacheEntry {
  files: EnhancedFileItem[];  // 扩展类型
  timestamp: number;
  /** Front Matter 提取完成时间戳（用于判断是否需要刷新） */
  frontmatterExtractedAt?: number;
}

// TTL 延长至 10 分钟（Front Matter 提取耗时较长，延长缓存时间）
const CACHE_TTL = 10 * 60 * 1000;
```

---

### 3.5 类型扩展：`shared/types.ts`

**文件路径**: `shared/types.ts`

#### 3.5.1 新增类型

```typescript
/**
 * 从 Front Matter 提取的增强文件项
 */
export interface EnhancedFileItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
  lastModified?: number;
  /** Front Matter 元数据 */
  frontmatter?: ArticleFrontmatter;
  /** 解析后的排序日期时间戳 */
  sortDate?: number;
}
```

---

## 四、API 调用优化

### 4.1 现有 API 复用

| API | 现有用途 | 新用途 |
|-----|---------|--------|
| `GET /api/repos/tree` | 获取文件列表 | 不变 |
| `GET /api/repos/file` | 编辑器读取全文 | **新增：Front Matter 提取** |

### 4.2 可选优化：后端 Range 读取

如果 GitHub API 支持（或通过后端代理实现），可优化为只读取文件头部：

```typescript
// 后端 cloudflare-worker/src/github.ts 新增
async function readFrontmatterHeader(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  maxBytes: number = 2048
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json();
  const content = atob(data.content);
  return content.slice(0, maxBytes);
}
```

**优点**：减少 80%+ 的网络传输（只读取头部而非全文）  
**缺点**：需要修改后端代码

---

## 五、降级策略

### 5.1 二级降级（不再使用 Commits API）

```
┌─────────────────────────────────────────────────────────┐
│  排序时间来源优先级                                       │
├─────────────────────────────────────────────────────────┤
│  Level 1: Front Matter date 字段                         │
│    ↓ 不存在或解析失败                                    │
│  Level 2: 文件名提取时间（YYYYMMDD 格式）                 │
└─────────────────────────────────────────────────────────┘
```

### 5.2 错误处理

| 场景 | 处理策略 |
|------|---------|
| 单个文件读取失败 | 重试 2 次（指数退避），仍失败则跳过该文件 |
| 全部文件读取失败 | 使用文件名时间降级排序 |
| GitHub API 限流（403/429） | 等待后重试，超时则使用降级策略 |
| 文件无 Front Matter | 跳过该文件，使用文件名提取时间 |

---

## 六、性能估算

### 6.1 场景：100 篇文章

| 指标 | 现有方案（废弃） | 新方案 |
|------|----------------|--------|
| **API 调用次数** | 1 (Trees) + 100 (Commits) = **101** | 1 (Trees) + 100 (Contents) = **101** |
| **后端处理时间** | 100 × 5s（串行分批）≈ **167s** ❌ | 100 × 0.5s（并行）≈ **10s** ✅ |
| **前端排序时间** | <1ms | <1ms |
| **总体响应时间** | **170s+** | **10-15s** |

> 注：Contents API 调用可通过后端 Range 读取优化至只返回前 2KB，数据量可降至 200KB。

### 6.2 优化后预估（启用 Range 读取）

| 指标 | 优化后 |
|------|--------|
| 单次调用数据量 | ~2KB × 100 = **200KB** |
| 后端处理时间 | **5-10s**（并行 + 缓存） |
| 首屏加载时间 | **3-5s**（含解析和排序） |

### 6.3 性能提升对比

```
┌─────────────────────────────────────────────────────────────┐
│  100 篇文章排序响应时间                                       │
├──────────────────┬──────────────────────────────────────────┤
│  现有方案         │  ████████████████████████████████████ 170s │
│  新方案           │  ████ 10s                                  │
│  性能提升         │  17x ⬆                                    │
└──────────────────┴──────────────────────────────────────────┘
```

---

## 七、实施计划

### Phase 1：核心功能（P0）

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 安装 `front-matter` 依赖 | `web/package.json` | P0 |
| 实现 `extractFrontMatter.ts` | 新增 | P0 |
| 新增 `sortByFrontMatterDate()` | `web/src/lib/sortFiles.ts` | P0 |
| 修改 `useFileList.ts` | `web/src/hooks/useFileList.ts` | P0 |
| 类型定义扩展 | `shared/types.ts` | P0 |

### Phase 2：废弃 Commits API（P1）

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 废弃 `getFileLastModified()` | `cloudflare-worker/src/github.ts` | P1 |
| 废弃 `getTree()` 中的 Commits 调用逻辑 | `cloudflare-worker/src/github.ts` | P1 |
| 清理未引用的 `lastModified` 字段 | 多处 | P1 |
| 后端 Range 读取优化（可选） | `cloudflare-worker/src/github.ts` | P1 |
| 缓存 TTL 调整 | `web/src/lib/fileCache.ts` | P1 |
| 错误处理与重试 | `extractFrontMatter.ts` | P1 |
| 单元测试 | 新增测试文件 | P1 |

### Phase 3：灰度与回滚（P2）

| 任务 | 说明 |
|------|------|
| 功能开关 | 添加 `USE_FRONT_MATTER_SORT` 环境变量控制 |
| 灰度发布 | 先对 10% 用户启用，观察 API 调用量和错误率 |
| 快速回滚 | 关闭功能开关，回退到文件名时间排序 |

---

## 八、风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| GitHub API 限流 | 高 | 中 | 并发控制（batchSize=5）+ 缓存 |
| 大文件读取超时 | 中 | 低 | Range 读取优化 + 超时控制 |
| Front Matter 格式不一致 | 中 | 中 | 二级降级策略（date → 文件名） |
| 浏览器内存溢出 | 低 | 极低 | 分批处理 + 垃圾回收 |
| 向后兼容性问题 | 高 | 低 | 功能开关 + 灰度发布 |

---

## 九、后续扩展

1. **多字段排序**：支持按 `title`、`author`、`tags` 等 Front Matter 字段排序
2. **服务端预解析**：后端在 `getTree` 时预先解析 Front Matter，前端直接接收结果
3. **增量更新**：监听文件变更事件，仅重新提取变更文件的 Front Matter
4. **全文搜索增强**：利用 Front Matter 元数据实现更精确的搜索过滤
