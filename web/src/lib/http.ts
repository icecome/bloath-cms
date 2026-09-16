// 统一 HTTP 客户端：超时 / 401 事件 / 双信封解析（comment 与 buffer 共用）
const DEFAULT_TIMEOUT_MS = 10000;

export type Envelope =
  | { code: number; message: string; data: unknown }
  | { success: boolean; data?: unknown; error?: string };

export interface HttpRequestOptions extends RequestInit {
  timeoutMs?: number;
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
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal, ...rest } = options;
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
    throw new Error('登录已过期，请重新登录');
  }

  let payload: Envelope;
  try {
    payload = (await res.json()) as Envelope;
  } catch {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return parseEnvelope<T>(payload);
}
