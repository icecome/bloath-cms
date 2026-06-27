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
  const [progress, setProgress] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const p = Math.min(elapsed / duration, 1);
      setProgress(p);
      if (elapsed >= duration) {
        clearInterval(interval);
        onCloseRef.current();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [duration]);

  const handleUndo = useCallback(() => {
    onClose();
    onUndo?.();
  }, [onClose, onUndo]);

  if (type === 'error') {
    return (
      <div className="fixed top-4 right-4 z-50 px-4 py-2.5 text-xs rounded-md shadow-sm bg-red-600 text-white transition-all">
        {message}
      </div>
    );
  }

  return (
    <div className="fixed top-4 right-4 z-50 px-4 py-2.5 text-xs rounded-md shadow-sm bg-[#37352F] text-white transition-all overflow-hidden">
      <div className="relative z-10 flex items-center gap-3">
        <span>{message}</span>
        {onUndo && (
          <button
            onClick={handleUndo}
            className="text-xs text-white underline hover:text-blue-200 flex-shrink-0"
          >
            {undoText}
          </button>
        )}
      </div>
      {/* 进度条 */}
      <div
        className="absolute bottom-0 left-0 h-0.5 bg-white/30 transition-all"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
