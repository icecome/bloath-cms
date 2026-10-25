import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  onUndo?: () => void;
  undoText?: string;
  /** 自动关闭毫秒数；0 = 不自动关闭（撤销类提示），缺省 4000 */
  duration?: number;
}

const MAX_TOASTS = 3;
const DEFAULT_DURATION_MS = 4000;

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (item: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const nextIdRef = useRef(0);

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = ++nextIdRef.current;
    setToasts((prev) => {
      const next = [...prev, { ...item, id }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });

    // duration: 0 = 不自动关闭（撤销类提示必须等到用户决策；P1-003：
    // 旧实现 4s 自动消失，用户还没看清撤销按钮提示就没了，撤销记录随之作废）
    const duration = item.duration ?? DEFAULT_DURATION_MS;
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, duration);
    timersRef.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id: number) => {
    clearTimer(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, [clearTimer]);

  // 防丢稿副本写失败（localStorage 配额满/隐私模式）全局提示（P2-39）：
  // store 层经 window 事件解耦，这里消费并只提示一次（事件源已做去重）
  useEffect(() => {
    const handler = () => {
      addToast({
        message: '本地草稿副本保存失败（存储空间不足或隐私模式）。请尽快手动保存文章，避免内容丢失。',
        type: 'warning',
        duration: 8000,
      });
    };
    window.addEventListener('draft:storage-failed', handler);
    return () => window.removeEventListener('draft:storage-failed', handler);
  }, [addToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内部使用');
  return ctx;
}