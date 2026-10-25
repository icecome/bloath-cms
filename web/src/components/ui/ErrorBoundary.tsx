import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex-1 flex items-center justify-center h-full">
          <div className="text-center p-8">
            <h2 className="text-lg font-medium text-destructive mb-2">页面出现故障</h2>
            <p className="text-sm text-muted-foreground mb-4">
              页面组件崩溃了。刷新会丢失未保存的内容；编辑器中的草稿有本地副本保护，重新打开后可恢复。
            </p>
            <details className="text-xs text-muted-foreground mb-4 max-w-md mx-auto text-left">
              <summary className="cursor-pointer hover:text-foreground">技术详情（供排查）</summary>
              <pre className="mt-2 whitespace-pre-wrap break-all bg-muted rounded-sm p-2">{this.state.error?.message}</pre>
            </details>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 text-sm bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
