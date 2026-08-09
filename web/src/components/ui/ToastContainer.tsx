import { useToast, type ToastItem } from '../../contexts/ToastContext';
import { X } from 'lucide-react';

interface ToastItemProps {
  toast: ToastItem;
}

function ToastItemComponent({ toast: t }: ToastItemProps) {
  const { dismissToast } = useToast();

  const handleUndo = () => {
    dismissToast(t.id);
    t.onUndo?.();
  };

  return (
    <div
      className="px-4 py-2.5 text-xs rounded-md shadow-sm bg-foreground text-white flex items-center gap-3 min-w-[200px] max-w-sm"
      role="alert"
    >
      <span className="flex-1">{t.message}</span>
      <div className="flex items-center gap-1 flex-shrink-0">
        {t.onUndo && (
          <button
            type="button"
            onClick={handleUndo}
            className="text-xs text-white underline hover:text-blue-200 px-1"
          >
            {t.undoText || '撤销'}
          </button>
        )}
        <button
          type="button"
          onClick={() => dismissToast(t.id)}
          className="text-white/80 hover:text-white p-0.5"
          aria-label="关闭"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
      {toasts.map((t: ToastItem) => (
        <ToastItemComponent key={t.id} toast={t} />
      ))}
    </div>
  );
}
