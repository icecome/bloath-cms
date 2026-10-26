import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_KEY,
  createNewVersionReloader,
  importWithRetry,
  isChunkLoadError,
  markReloadForNewVersion,
  resetReloadGuardForTests,
  shouldReloadForNewVersion,
} from './chunkRecovery.ts';
import type { StorageLike } from './storageLike.ts';

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  /** 模拟隐私模式：写入抛错 */
  failOnSet = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnSet) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const sleepStub = async () => {};

describe('isChunkLoadError', () => {
  it('识别 Chrome/Edge 的动态 import 失败', () => {
    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://bloath.icecome.com/assets/EditorPage-CEAxN2e1.js',
    );
    assert.equal(isChunkLoadError(err), true);
  });

  it('识别 Firefox 与 Safari 的措辞', () => {
    assert.equal(isChunkLoadError(new Error('error loading dynamically imported module')), true);
    assert.equal(isChunkLoadError(new TypeError('Importing a module script failed.')), true);
    assert.equal(isChunkLoadError(new TypeError('Load failed')), true);
  });

  it('识别 Vite preload 助手的 CSS 依赖失败', () => {
    assert.equal(isChunkLoadError(new Error('Unable to preload CSS for /assets/index-x.css')), true);
  });

  it('字符串形式的错误同样识别', () => {
    assert.equal(isChunkLoadError('Failed to fetch dynamically imported module: /assets/x.js'), true);
  });

  it('模块内部求值抛错不误判为分块失败', () => {
    assert.equal(isChunkLoadError(new Error('Cannot read properties of undefined (reading "default")')), false);
    assert.equal(isChunkLoadError(new SyntaxError('Unexpected token')), false);
    assert.equal(isChunkLoadError(null), false);
    assert.equal(isChunkLoadError(undefined), false);
    assert.equal(isChunkLoadError({ code: 500 }), false);
  });
});

describe('importWithRetry', () => {
  const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/a.js');

  it('传输瞬断：重试后成功，不触发重载', async () => {
    let calls = 0;
    let reloadCalls = 0;
    const result = await importWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw chunkError();
        return { default: 'editor' };
      },
      { sleep: sleepStub, reloadForNewVersion: () => { reloadCalls += 1; return true; } },
    );

    assert.deepEqual(result, { default: 'editor' });
    assert.equal(calls, 3);
    assert.equal(reloadCalls, 0);
  });

  it('非分块错误立即透传，只尝试一次', async () => {
    let calls = 0;
    const boom = new Error('boom inside module');
    await assert.rejects(
      importWithRetry(
        async () => {
          calls += 1;
          throw boom;
        },
        { sleep: sleepStub, reloadForNewVersion: () => { throw new Error('不应触发重载'); } },
      ),
      boom,
    );
    assert.equal(calls, 1);
  });

  it('重试耗尽且不允许重载：抛最后一次错误', async () => {
    let calls = 0;
    let reloadCalls = 0;
    await assert.rejects(
      importWithRetry(
        async () => {
          calls += 1;
          throw chunkError();
        },
        {
          retries: 2,
          sleep: sleepStub,
          reloadForNewVersion: () => {
            reloadCalls += 1;
            return false;
          },
        },
      ),
      /Failed to fetch dynamically imported module/,
    );
    assert.equal(calls, 3);
    assert.equal(reloadCalls, 1);
  });

  it('触发重载时保持加载态：窗口内 promise 不 settle', async () => {
    const settled = await Promise.race([
      importWithRetry(
        async () => {
          throw chunkError();
        },
        { retries: 0, sleep: sleepStub, reloadForNewVersion: () => true, reloadTimeoutMs: 1_000 },
      ).then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('pending'), 20);
      }),
    ]);

    assert.equal(settled, 'pending');
  });

  it('重载没有生效：超时后以最后一次分块错误失败，让 UI 落到错误态', async () => {
    const error = await importWithRetry(
      async () => {
        throw chunkError();
      },
      { retries: 0, sleep: sleepStub, reloadForNewVersion: () => true, reloadTimeoutMs: 20 },
    ).then(
      () => null,
      (err: unknown) => err,
    );

    assert.ok(error instanceof Error);
    // 保持分块错误类型：UI 据此显示「重新加载页面资源」而不是通用失败
    assert.equal(isChunkLoadError(error), true);
    assert.match(error.message, /Failed to fetch dynamically imported module/);
  });
});

describe('换新版本重载守卫', () => {
  beforeEach(() => {
    resetReloadGuardForTests();
  });

  it('首次允许重载，冷却窗口内拒绝', () => {
    const storage = new MemoryStorage();
    const now = 1_700_000_000_000;

    assert.equal(shouldReloadForNewVersion(storage, now), true);
    markReloadForNewVersion(storage, now);
    assert.equal(storage.getItem(CHUNK_RELOAD_KEY), String(now));
    assert.equal(shouldReloadForNewVersion(storage, now + 1_000), false);
  });

  it('冷却窗口过期后重新允许', () => {
    const storage = new MemoryStorage();
    const now = 1_700_000_000_000;
    markReloadForNewVersion(storage, now);

    assert.equal(shouldReloadForNewVersion(storage, now + CHUNK_RELOAD_COOLDOWN_MS + 1), true);
  });

  it('storage 写入失败时仍有进程内守卫，不会刷新循环', () => {
    const storage = new MemoryStorage();
    storage.failOnSet = true;
    const now = 1_700_000_000_000;

    markReloadForNewVersion(storage, now);
    assert.equal(storage.getItem(CHUNK_RELOAD_KEY), null);
    assert.equal(shouldReloadForNewVersion(storage, now + 500), false);
  });

  it('storage 损坏值按未记录处理', () => {
    const storage = new MemoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, 'not-a-number');
    assert.equal(shouldReloadForNewVersion(storage, 1_700_000_000_000), true);
  });

  it('createNewVersionReloader：窗口内只重载一次', () => {
    const storage = new MemoryStorage();
    let reloads = 0;
    const reload = createNewVersionReloader({
      storage,
      reload: () => {
        reloads += 1;
      },
      now: () => 1_700_000_000_000,
    });

    assert.equal(reload(), true);
    assert.equal(reload(), false);
    assert.equal(reloads, 1);
  });
});
