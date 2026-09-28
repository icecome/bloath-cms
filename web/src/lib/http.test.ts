import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvelope, requestJson, HttpError } from './http.ts';

// requestJson 依赖浏览器的 fetch 与 window.dispatchEvent，Node 环境中需打桩
const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;

type FetchCall = { url: string; init: RequestInit | undefined };
let calls: FetchCall[] = [];
let dispatched: string[] = [];

function mockWindow() {
  (globalThis as { window?: unknown }).window = {
    dispatchEvent: (event: Event) => { dispatched.push(event.type); return true; },
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('parseEnvelope', () => {
  it('accepts code envelope success', () => {
    assert.equal(parseEnvelope<number>({ code: 0, message: 'ok', data: 42 }), 42);
  });

  it('throws on code envelope error', () => {
    assert.throws(
      () => parseEnvelope({ code: 400, message: 'bad', data: null }),
      /bad/
    );
  });

  it('accepts success envelope', () => {
    assert.deepEqual(parseEnvelope<{ a: number }>({ success: true, data: { a: 1 } }), { a: 1 });
  });

  it('throws on success envelope error', () => {
    assert.throws(
      () => parseEnvelope({ success: false, error: 'nope' }),
      /nope/
    );
  });
});

describe('requestJson', () => {
  beforeEach(() => {
    calls = [];
    dispatched = [];
    mockWindow();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('returns data from code envelope', async () => {
    mockFetch(() => jsonResponse({ code: 0, message: 'ok', data: { id: 7 } }));
    const result = await requestJson<{ id: number }>('/api/x', {}, 'https://api.test');
    assert.deepEqual(result, { id: 7 });
    assert.equal(calls[0]?.url, 'https://api.test/api/x');
  });

  it('sends credentials and the CSRF header', async () => {
    mockFetch(() => jsonResponse({ code: 0, message: 'ok', data: null }));
    await requestJson('/api/x');
    assert.equal(calls[0]?.init?.credentials, 'include');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['X-Requested-With'], 'XMLHttpRequest');
  });

  it('returns undefined for 204 without reading a body', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    const result = await requestJson<void>('/api/x');
    assert.equal(result, undefined);
  });

  it('throws HttpError with status 401 and dispatches auth:expired', async () => {
    mockFetch(() => jsonResponse({ error: 'nope' }, 401));
    await assert.rejects(
      () => requestJson('/api/x'),
      (err: unknown) => {
        assert.ok(err instanceof HttpError, '应为 HttpError 实例');
        assert.equal(err.status, 401);
        return true;
      }
    );
    assert.deepEqual(dispatched, ['auth:expired']);
  });

  it('throws HttpError with status 503 for GitHub unavailability', async () => {
    mockFetch(() => jsonResponse({ error: 'down' }, 503));
    await assert.rejects(
      () => requestJson('/api/x'),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 503);
        return true;
      }
    );
  });

  it('throws HttpError carrying status when the body is not JSON', async () => {
    mockFetch(() => new Response('<html>oops</html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    }));
    await assert.rejects(
      () => requestJson('/api/x'),
      (err: unknown) => {
        assert.ok(err instanceof HttpError, '非 JSON 响应应抛 HttpError 以便按状态码判断');
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it('carries the HTTP status on business errors from a JSON envelope', async () => {
    // 这是 m-12 的根因场景：404 走 JSON 信封时，message 不含状态码文本
    mockFetch(() => jsonResponse({ code: 404, message: 'File not found', data: null }, 404));
    await assert.rejects(
      () => requestJson('/api/x'),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 404);
        assert.ok(!err.message.includes('404'), 'message 不应含状态码文本，调用方必须依赖 status');
        return true;
      }
    );
  });

  it('throws on timeout when the request is aborted', async () => {
    mockFetch((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));
    await assert.rejects(() => requestJson('/api/x', { timeoutMs: 10 }), /请求超时/);
  });

  it('aborts immediately when the provided signal is already aborted', async () => {
    mockFetch((_url, init) => new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
      else init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await assert.rejects(() => requestJson('/api/x', { signal: AbortSignal.abort() }), /请求超时/);
  });

  it('reports a network failure when fetch rejects', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    await assert.rejects(() => requestJson('/api/x'), /网络连接失败/);
  });

  it('throws when skipDataCheck is off and data is undefined', async () => {
    mockFetch(() => jsonResponse({ success: true }));
    await assert.rejects(() => requestJson('/api/x'), /响应数据为空/);
  });

  it('accepts undefined data when skipDataCheck is on', async () => {
    mockFetch(() => jsonResponse({ success: true }));
    const result = await requestJson<void>('/api/x', { skipDataCheck: true });
    assert.equal(result, undefined);
  });
});
