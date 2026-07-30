import { useState, useEffect, useCallback, useRef } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
  onUndo?: () => void;
  undoText?: string;
  duration?: number;
}

export default function Toast({ message, type, onClose, onUndo, undoText = '撤销', duration = 10000 }: ToastProps) {
  const [shrinking, setShrinking] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // 下一帧启动进度条收缩动画，确保浏览器先渲染初始宽度
    const rafId = requestAnimationFrame(() => setShrinking(true));
    // 到期关闭
    const timeoutId = setTimeout(() => onCloseRef.current(), duration);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [duration]);

  const handleUndo = useCallback(() => {
    onClose();
    onUndo?.();
  }, [onClose, onUndo]);

  if (type === 'error') {
    return (
      <div className="fixed top-4 right-4 z-50 px-4 py-2.5 text-xs rounded-md shadow-sm bg-red-600 text-white transition-all flex items-center gap-3">
        <span>{message}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-white/80 hover:text-white flex-shrink-0"
          aria-label="关闭"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-4 right-4 z-50 px-4 py-2.5 text-xs rounded-md shadow-sm bg-foreground text-white transition-all overflow-hidden">
      <div className="relative z-10 flex items-center gap-3">
        <span>{message}</span>
        {onUndo && (
          <button
            type="button"
            onClick={handleUndo}
            className="text-xs text-white underline hover:text-blue-200 flex-shrink-0"
          >
            {undoText}
          </button>
        )}
      </div>
      {/* 进度条：CSS transition 驱动，避免 JS 高频 setState */}
      <div
        className="absolute bottom-0 left-0 h-0.5 bg-white/30"
        style={{
          width: shrinking ? '0%' : '100%',
          transition: `width ${duration}ms linear`
        }}
      />
    </div>
  );
}
