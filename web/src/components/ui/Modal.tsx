import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 模态栈：记录当前打开的对话框，顺序为「底层 → 顶层」。
 *
 * 为什么需要：所有 Modal 都把 keydown 监听挂在 document 的**捕获阶段**，
 * 而 stopPropagation 只阻止事件继续传播到其他节点，**不阻止同一节点上的其他监听器**。
 * 两个 Modal 嵌套时（如媒体选择器里再开上传弹窗），按一次 Escape 会触发两层
 * 的 onClose —— 一次关掉两个对话框，用户的既有选择随之丢失；Tab 的焦点循环
 * 也会被两层同时争抢，焦点可能逃逸到被遮住的下层对话框。
 *
 * 只有栈顶（最后 push 的那个）响应 Escape 与 Tab，即可消除这两个问题。
 */
const modalStack: Array<{ id: symbol; onClose: () => void }> = [];

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
  const stackIdRef = useRef<symbol | null>(null);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    // 入栈：本 Modal 成为当前栈顶（嵌套时仅栈顶响应 Escape/Tab，见 modalStack 注释）
    const stackId = Symbol('modal');
    stackIdRef.current = stackId;
    modalStack.push({ id: stackId, onClose });

    const panel = panelRef.current;
    // 初始焦点：面板容器先行，再交给首个可聚焦元素——容器 tabIndex=-1 避免
    // 焦点直接落在右上角关闭 X 上（回车即误关，P2-7）
    panel?.focus();
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();

    // body 滚动锁定：对话框打开时背景页跟滚（移动端长面板尤其明显），P2-6
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      // 仅栈顶响应：嵌套对话框时 Escape/Tab 只作用于最上层
      const top = modalStack[modalStack.length - 1];
      if (top?.id !== stackId) return;

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
      // 出栈（可能已被其他清理路径移除，故按 id 过滤而非按索引 splice）
      const idx = modalStack.findIndex((entry) => entry.id === stackId);
      if (idx >= 0) modalStack.splice(idx, 1);
      document.body.style.overflow = prevOverflow;
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
        tabIndex={-1}
        className={`${className} overscroll-contain outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
