// 懒加载分块（code-splitting chunk）拉取失败后的恢复策略。
//
// 触发场景：生产构建把 EditorPage 拆成独立 chunk（`assets/EditorPage-<hash>.js`），
// 只在进入 `/editor/*` 时才 fetch。以下情况会让这次 fetch 失败：
//
// 1. 部署后旧 chunk 已下线 —— 页面是上一个版本渲染的，hash 指向的文件在新部署里
//    不存在；Cloudflare Pages 对未命中路径回落 `index.html`（200 + text/html），
//    模块因 MIME 校验失败，浏览器统一报
//    `Failed to fetch dynamically imported module: <url>`。
// 2. 传输层瞬断（TLS/连接重置、边缘节点抖动）—— 实测生产资源端点并发请求会出现
//    `curl: (35) Recv failure: Connection was reset`。
// 3. 中间设备返回非 JS 内容（代理拦截、限流页、WAF 挑战页）。
//
// 应对分两级：先短延迟重试（覆盖 2/3，不动页面）；仍失败即判为 1，整页重载一次
// 换取新 hash（重载用 sessionStorage 冷却窗口防循环，窗口内再失败则抛错交给 UI）。
//
// 纯逻辑 + 依赖注入，可直接被 node:test 覆盖；浏览器绑定见 getReloadForNewVersion。

import type { StorageLike } from './storageLike.ts';

/**
 * 浏览器在「模块脚本拉取/解析失败」时抛出的错误文案特征。
 * 四家引擎措辞不同，字符串匹配是唯一可用的判据（各引擎都不带结构化 error code）。
 */
const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i, // Chrome / Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite preload 助手：CSS 依赖 404 时
  /Load failed/i, // Safari：fetch 失败
  /ChunkLoadError/i, // webpack 兼容写法（历史产物/第三方 SDK）
];

/**
 * 判断错误是否属于「分块没拿到」。
 *
 * 只认加载失败：模块内部求值抛出的异常不能当成分块失败重试——那会把真正的代码
 * 缺陷重放两次，并把用户卡在重载循环里。
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = errorMessage(error);
  if (!message) return false;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; name?: unknown };
    const parts = [maybe.name, maybe.message].filter((v): v is string => typeof v === 'string');
    if (parts.length > 0) return parts.join(': ');
  }
  return '';
}

/** sessionStorage 中记录「上一次为换新版本而重载」的时间戳 */
export const CHUNK_RELOAD_KEY = 'bloath:chunk-reload-at';

/** 重载冷却窗口：窗口内再次失败说明重载解决不了，直接报错，避免刷新循环 */
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

/**
 * 进程内兜底时间戳：隐私模式下 sessionStorage 写会抛错，若只依赖 storage
 * 守卫会失效并进入刷新循环，故用模块级变量再兜一层。
 */
let inMemoryReloadAt = 0;

/** 冷却窗口外（或没有记录）才允许为换新版本而重载 */
export function shouldReloadForNewVersion(
  storage: StorageLike | null,
  now: number = Date.now(),
  cooldownMs: number = CHUNK_RELOAD_COOLDOWN_MS,
): boolean {
  const recorded = readReloadAt(storage);
  const last = Math.max(recorded, inMemoryReloadAt);
  if (last === 0) return true;
  return now - last > cooldownMs;
}

/** 记录本次重载时间（storage 异常时静默降级到进程内记录） */
export function markReloadForNewVersion(storage: StorageLike | null, now: number = Date.now()): void {
  inMemoryReloadAt = now;
  if (!storage) return;
  try {
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // 配额满/隐私模式：进程内记录已生效，无需额外处理
  }
}

function readReloadAt(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(CHUNK_RELOAD_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** 测试专用：清空进程内兜底时间戳 */
export function resetReloadGuardForTests(): void {
  inMemoryReloadAt = 0;
}

export interface NewVersionReloaderOptions {
  /** 会话级 storage；不可用时传 null（仅靠进程内守卫） */
  storage: StorageLike | null;
  /** 触发整页重载（测试注入桩） */
  reload: () => void;
  now?: () => number;
  cooldownMs?: number;
}

/**
 * 组装「按需整页重载」函数：返回 true 表示已发起重载，调用方应停在加载态。
 * 返回 false 表示冷却窗口内已重载过，调用方应把错误抛给 UI。
 */
export function createNewVersionReloader(options: NewVersionReloaderOptions): () => boolean {
  const { storage, reload, now = Date.now, cooldownMs = CHUNK_RELOAD_COOLDOWN_MS } = options;
  return () => {
    const at = now();
    if (!shouldReloadForNewVersion(storage, at, cooldownMs)) return false;
    markReloadForNewVersion(storage, at);
    reload();
    return true;
  };
}

function readSessionStorage(): StorageLike | null {
  const g = globalThis as { sessionStorage?: StorageLike };
  try {
    return g.sessionStorage ?? null;
  } catch {
    // 部分浏览器在禁用 Cookie/存储时访问属性本身就会抛错
    return null;
  }
}

let browserReloader: (() => boolean) | null = null;

/**
 * 浏览器侧单例：sessionStorage + location.reload。
 * 懒构建——Node 测试环境 import 本模块不应触碰浏览器 API。
 */
export function getReloadForNewVersion(): () => boolean {
  if (browserReloader) return browserReloader;
  browserReloader = createNewVersionReloader({
    storage: readSessionStorage(),
    reload: () => {
      if (typeof window !== 'undefined') window.location.reload();
    },
  });
  return browserReloader;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface ImportWithRetryOptions {
  /** 首次失败后的重试次数（默认 2，共 3 次尝试） */
  retries?: number;
  /** 重试间隔基数，按尝试次数线性放大（默认 300ms → 300ms, 600ms） */
  retryDelayMs?: number;
  /** 注入 sleep（测试用） */
  sleep?: (ms: number) => Promise<void>;
  /**
   * 判定为「旧 chunk 已下线」后调用：返回 true 表示已发起整页重载，
   * 此时 importWithRetry 返回永不 settle 的 promise（保持加载态，不闪错误 UI）。
   */
  reloadForNewVersion?: () => boolean;
  /**
   * 发起重载后等待页面真正卸载的上限（默认 5000ms）。
   * 超时说明导航没有发生（被拦截、被取消、浏览器 no-op），此时按失败处理，
   * 让 UI 落到可重试的错误态，而不是永远停在加载中。
   */
  reloadTimeoutMs?: number;
}

/** 重载未生效的判定窗口 */
export const DEFAULT_RELOAD_TIMEOUT_MS = 5_000;

/**
 * 带重试与「换新版本重载」的动态 import 包装。
 *
 * - 非分块类错误（模块求值抛错、语法错误）立即透传，不重试；
 * - 分块类错误按 retries 重试；
 * - 全部失败后尝试整页重载一次；重载被冷却窗口拦下则抛出最后一次错误；
 * - 重载已发起但 reloadTimeoutMs 内页面没有卸载，按最后一次分块错误失败。
 */
export async function importWithRetry<T>(
  loader: () => Promise<T>,
  options: ImportWithRetryOptions = {},
): Promise<T> {
  const {
    retries = 2,
    retryDelayMs = 300,
    sleep = defaultSleep,
    reloadForNewVersion,
    reloadTimeoutMs = DEFAULT_RELOAD_TIMEOUT_MS,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1));
      }
    }
  }

  if (reloadForNewVersion?.()) {
    // 页面即将重载：先停在加载态，避免重载前闪一帧失败提示；
    // 但导航本身可能不生效（被拦截/取消/no-op），必须有兜底超时。
    return waitForReload<T>(lastError, reloadTimeoutMs);
  }

  throw lastError;
}

/**
 * 等页面卸载，超时则以最后一次分块错误失败。
 *
 * 不用「永不 settle 的 promise」：即便待定 promise 无人引用时能被 GC 回收（实测可回收，
 * 不构成泄漏），一旦导航没有发生，界面会永远停在加载中且没有任何错误出口——
 * 这违反「禁止静默失败」。超时把控制权交回 UI，用户可以就地重试或手动刷新。
 */
function waitForReload<T>(lastError: unknown, timeoutMs: number): Promise<T> {
  return new Promise<T>((_, reject) => {
    const timer: unknown = setTimeout(() => {
      reject(
        lastError instanceof Error
          ? lastError
          : new Error('页面重载没有生效'),
      );
    }, timeoutMs);
    // Node 环境下未清理的定时器会拖住进程退出；浏览器返回 number，无此方法
    (timer as { unref?: () => void }).unref?.();
  });
}

/** 供 UI 展示的简短原因（不泄露内部细节） */
export function describeChunkLoadFailure(error: unknown): string {
  return isChunkLoadError(error)
    ? '页面资源没能取到，通常是刚发布了新版本，或网络瞬断。'
    : '编辑器模块加载出错。';
}
