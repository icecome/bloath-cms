// 统一 HTTP 客户端：超时 / 401 事件 / 双信封解析（comment 与 buffer 共用）
const DEFAULT_TIMEOUT_MS = 10000;

export type Envelope =
  | { code: number; message: string; data: unknown }
  | { success: boolean; data?: unknown; error?: string };

export interface HttpRequestOptions extends RequestInit {
  timeoutMs?: number;
  /** 跳过「响应数据为空」校验，用于 204/void 响应 */
  skipDataCheck?: boolean;
}

/**
 * 携带 HTTP 状态码的错误。
 * 调用方应按 `err.status` 判断状态，而不是匹配 message 文本：
 * 本模块仅在响应体不是 JSON 时才生成含状态码的 message，
 * 走 JSON 信封的响应会抛出业务 message（不含「404」等字样），
 * 依赖文本判断的分支会永久失效。
 *
 * 注：不用构造函数参数属性（`constructor(public status: number)`）——
 * 测试以 `node --experimental-strip-types` 运行，strip-only 模式不支持该语法。
 */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function parseEnvelope<T>(payload: Envelope): T {
  if (typeof (payload as { code?: unknown }).code === 'number') {
    const body = payload as { code: number; message: string; data: T };
    if (body.code !== 0) throw new Error(body.message || '请求失败');
    return body.data;
  }
  const body = payload as { success: boolean; data?: T; error?: string };
  if (body.success === false) throw new Error(body.error || '请求失败');
  return body.data as T;
}

export async function requestJson<T>(
  pathOrUrl: string,
  options: HttpRequestOptions = {},
  baseUrl = ''
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal, skipDataCheck = false, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
    res = await fetch(url, {
      ...rest,
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest', ...headers },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('请求超时');
    throw new Error('网络连接失败');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new HttpError(401, '登录已过期，请重新登录');
  }

  if (res.status === 503) {
    throw new HttpError(503, 'GitHub API 暂不可用，请稍后重试');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let payload: Envelope;
  try {
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) throw new Error('not json');
    payload = (await res.json()) as Envelope;
  } catch {
    throw new HttpError(res.status, `HTTP ${res.status}: ${res.statusText}`);
  }

  // 信封内的业务错误带上 HTTP 状态码，供调用方按 status 判断（详见 HttpError 注释）
  try {
    const data = parseEnvelope<T>(payload);
    if (!skipDataCheck && data === undefined) {
      throw new Error('响应数据为空');
    }
    return data;
  } catch (err) {
    if (err instanceof Error && !res.ok) {
      throw new HttpError(res.status, err.message);
    }
    throw err;
  }
}
