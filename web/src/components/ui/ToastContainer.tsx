import { useToast, type ToastItem, type ToastType } from '../../contexts/ToastContext';
import { X } from 'lucide-react';

// 浅底 + 语义色文字：深色文字压极浅底，对比度与压白底相当（≥4.5:1）；
// 此前用白字压饱和语义色，success/warning 仅 2.2:1、primary/destructive 3.9:1，均不达标
const toastStyles: Record<ToastType, string> = {
  success: 'bg-success/10 text-success border border-success/25',
  error: 'bg-destructive/10 text-destructive border border-destructive/25',
  warning: 'bg-warning/10 text-warning border border-warning/25',
  info: 'bg-primary-text/10 text-primary-text border border-primary-text/25',
};

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
      className={`px-4 py-2.5 text-xs rounded-md shadow-sm flex items-center gap-3 min-w-[200px] max-w-sm ${toastStyles[t.type] || toastStyles.info}`}
      role="status"
    >
      <span className="flex-1">{t.message}</span>
      <div className="flex items-center gap-1 flex-shrink-0">
        {t.onUndo && (
          <button
            type="button"
            onClick={handleUndo}
            className="text-xs underline hover:no-underline px-1 font-medium"
          >
            {t.undoText || '撤销'}
          </button>
        )}
        <button
          type="button"
          onClick={() => dismissToast(t.id)}
          className="opacity-70 hover:opacity-100 p-0.5"
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
