import { useEffect, useState, useCallback, type ComponentType, type ReactNode } from 'react';
import {
  describeChunkLoadFailure,
  getReloadForNewVersion,
  importWithRetry,
  isChunkLoadError,
} from '../../lib/chunkRecovery';

type RouteComponent = ComponentType<Record<string, never>>;

type State =
  | { status: 'loading' }
  | { status: 'ready'; Component: RouteComponent }
  | { status: 'error'; error: unknown };

interface Props {
  /** 分块加载器。必须是稳定引用（模块级常量），否则每次渲染都会重新拉取模块 */
  load: () => Promise<{ default: RouteComponent }>;
  /** 加载中占位；缺省时用与路由同层的加载提示 */
  fallback?: ReactNode;
}

/**
 * 懒加载路由的加载器。
 *
 * 不用 React.lazy 的原因：`lazy()` 会把失败结果永久缓存在组件上，一旦分块没拿到，
 * 这个页面在本次会话里就再也打不开，只能整页刷新；且错误会冒到根 ErrorBoundary，
 * 把布局外壳一起打死。这里把加载状态放在组件内，失败可以就地重试。
 *
 * 分块失败的判定与恢复见 lib/chunkRecovery.ts。
 */
export default function LazyRoute({ load, fallback }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    importWithRetry(load, { reloadForNewVersion: getReloadForNewVersion() })
      .then((module) => {
        if (cancelled) return;
        setState({ status: 'ready', Component: module.default });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('[LazyRoute] 分块加载失败：', error);
        setState({ status: 'error', error });
      });

    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  if (state.status === 'ready') {
    const { Component } = state;
    return <Component />;
  }

  if (state.status === 'loading') {
    return (
      <>
        {fallback ?? (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto border-border"></div>
              <p className="mt-3 text-sm text-muted-foreground">加载中……</p>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center h-full" role="alert">
      <div className="text-center p-8 max-w-md">
        <h2 className="text-lg font-medium text-destructive mb-2">编辑器没能加载</h2>
        <p className="text-sm text-muted-foreground mb-4">{describeChunkLoadFailure(state.error)}</p>
        <p className="text-xs text-muted-foreground mb-4">
          本机保存的草稿副本不受影响；重试会重新拉取页面资源。
        </p>
        <details className="text-xs text-muted-foreground mb-4 text-left">
          <summary className="cursor-pointer hover:text-foreground">技术详情（供排查）</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all bg-muted rounded-sm p-2">
            {state.error instanceof Error ? state.error.message : String(state.error)}
          </pre>
        </details>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={retry}
            className="px-4 py-2 text-sm bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
          >
            {isChunkLoadError(state.error) ? '重新加载页面资源' : '重试'}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm border border-border rounded-sm hover:bg-muted transition-colors"
          >
            刷新页面
          </button>
        </div>
      </div>
    </div>
  );
}
