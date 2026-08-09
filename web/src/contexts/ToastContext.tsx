import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  onUndo?: () => void;
  undoText?: string;
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

    const duration = item.duration ?? DEFAULT_DURATION_MS;
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