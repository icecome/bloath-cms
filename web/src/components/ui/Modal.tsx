import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  /** 对话框可访问名，同时用于 aria-labelledby 关联的标题元素 id */
  labelledBy?: string;
  /** 无可见标题时提供，作为 aria-label */
  ariaLabel?: string;
  /** 遮罩点击是否关闭，默认 true */
  closeOnOverlay?: boolean;
  onClose: () => void;
  className?: string;
  overlayClassName?: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 对话框外壳：统一处理 role/aria-modal、Escape 关闭、遮罩点击关闭与焦点陷阱。
 * 打开时记住触发元素，关闭后归还焦点；Tab 在对话框内循环，不逃逸到背景内容。
 */
export default function Modal({
  labelledBy,
  ariaLabel,
  closeOnOverlay = true,
  onClose,
  className = '',
  overlayClassName = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40',
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // 初始焦点：优先首个可聚焦元素，避免焦点留在背景触发按钮上
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreFocusRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={overlayClassName}
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        className={className}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
