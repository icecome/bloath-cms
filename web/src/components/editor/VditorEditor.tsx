import { useEffect, useRef, useCallback, useLayoutEffect, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

interface VditorEditorProps {
  initialContent?: string;
  onInput?: (value: string) => void;
  onReady?: (instance: Vditor) => void;
  /**
   * 「插入图片」按钮回调。
   * Vditor 原生工具栏没有图片插入按钮（只有 upload，走附件链接而非图片语法），
   * 因此这里用自定义工具栏项承接：点击后由调用方打开媒体库选择器，
   * 拿到 URL 后调用 editorRef 暴露的 insertImages 写回 Markdown。
   * 不传则仍用原生的 upload 按钮。
   */
  onPickImages?: () => void;
}

/** 工具栏「插入图片」图标（与项目极简线性风格一致，16px） */
const INSERT_IMAGE_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/>'
  + '<circle cx="5.6" cy="6" r="1.2" fill="currentColor"/>'
  + '<path d="M3 11.5L6.2 8.4L8.2 10.2L10.6 7.8L13 10.2" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>'
  + '</svg>';

/** 桌面端完整工具栏（自定义图片按钮替代原生 upload 的图片场景） */
const DESKTOP_TOOLBAR = [
  'emoji', 'headings', 'bold', 'italic', 'strike', '|',
  'line', 'quote', 'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
  'link', 'mediaImage', 'upload', 'code', 'inline-code', '|',
  'table', 'export', 'fullscreen', 'edit-mode', 'preview', 'record', 'help'
] as const;

/**
 * 移动端精简工具栏（P3-6）：窄屏上完整工具栏会横向溢出，保留高频项——
 * 标题/加粗/斜体/引用/列表/链接/图片/代码/预览切换；导出、录音、fullscreen 等低频项移除。
 */
const MOBILE_TOOLBAR = [
  'headings', 'bold', 'italic', '|',
  'quote', 'list', 'ordered-list', '|',
  'link', 'mediaImage', 'code', '|',
  'edit-mode', 'preview'
] as const;

/**
 * 组装工具栏：把数组里的 'mediaImage' 字符串占位符替换为真实的自定义按钮对象。
 * 没有媒体库回调时移除占位符（按钮无意义，且点击会调用 undefined）。
 * 必须用「替换」而非「追加」：占位符已存在于 DESKTOP/MOBILE_TOOLBAR 中，
 * 追加会得到两个同 name 项——一个是无 icon 无 click 的空按钮（点击抛 TypeError）。
 */
function buildToolbar(
  base: readonly string[],
  mediaImageButton: Record<string, unknown> | null
): Array<string | Record<string, unknown>> {
  return base
    .filter((item) => item !== 'mediaImage' || mediaImageButton !== null)
    .map((item) => (item === 'mediaImage' && mediaImageButton ? mediaImageButton : item));
}

/** 窄屏判定阈值，与 Tailwind md 断点一致 */
const MOBILE_BREAKPOINT_PX = 768;

export default function VditorEditor({ initialContent, onInput, onReady, onPickImages }: VditorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  const contentRef = useRef(initialContent);
  contentRef.current = initialContent;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onPickImagesRef = useRef(onPickImages);
  onPickImagesRef.current = onPickImages;
  // 初始化失败必须落到用户可见状态：写作主路径的静默空白是最危险的故障形态（P1-005）
  const [initError, setInitError] = useState<string | null>(null);

  const initializeVditor = useCallback(() => {
    if (!editorRef.current || vditorRef.current) return;

    // 初始化时按视口宽度选工具栏（编辑器生命周期内不重建，切屏后刷新生效）
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;

    try {
      // 自定义「插入图片」按钮：点击后交给外部的媒体库选择器，
      // 选中的图片由 insertImages 回调写回（Vditor 无原生图片插入按钮）
      const mediaImageButton = onPickImagesRef.current
        ? {
            name: 'mediaImage',
            tip: '插入图片',
            tipPosition: 's' as const,
            icon: INSERT_IMAGE_ICON,
            click: () => onPickImagesRef.current?.(),
          }
        : null;

      const instance = new Vditor(editorRef.current, {
        height: '100%',
        mode: 'ir',
        placeholder: '开始编写 Markdown 内容……',
        cache: { enable: false },
        toolbarConfig: { pin: true },
        lang: 'zh_CN',
        toolbar: buildToolbar(
          isMobile ? MOBILE_TOOLBAR : DESKTOP_TOOLBAR,
          mediaImageButton
        ) as unknown as string[],
        after: () => {
          setInitError(null);
          const content = contentRef.current;
          if (content) {
            instance.setValue(content);
          }
          onReadyRef.current?.(instance);
        },
        input: (val: string) => {
          onInputRef.current?.(val);
        }
      });
      vditorRef.current = instance;
    } catch (err) {
      console.error('Vditor 初始化失败：', err);
      setInitError(err instanceof Error ? err.message : '编辑器初始化失败，请重试');
    }
  }, []);

  const handleRetry = useCallback(() => {
    // 销毁半初始化实例后重建；Vditor destroy 抛错时实例状态不可信，直接置空重建
    try {
      vditorRef.current?.destroy();
    } catch {
      // 忽略销毁异常（同卸载路径）
    }
    vditorRef.current = null;
    setInitError(null);
    initializeVditor();
  }, [initializeVditor]);

  useEffect(() => {
    return () => {
      try {
        vditorRef.current?.destroy();
      } catch (err) {
        // destroy 期间 Vditor 内部 DOM 已被 React 卸载时可能抛错：
        // 卸载路径无法恢复，仅记录便于诊断
        console.warn('[VditorEditor] 编辑器销毁异常（已忽略）：', err);
      }
      vditorRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!editorRef.current || vditorRef.current) return;
    initializeVditor();
  }, [initializeVditor]);

  if (initError) {
    return (
      <div className="h-full flex items-center justify-center" role="alert">
        <div className="text-center p-8">
          <p className="text-sm text-destructive mb-1">编辑器加载失败</p>
          <p className="text-xs text-muted-foreground mb-4 max-w-xs break-all">{initError}</p>
          <p className="text-xs text-muted-foreground mb-4">未保存内容仍在本页内存与本地草稿副本中，重试不会丢失。</p>
          <button
            type="button"
            onClick={handleRetry}
            className="px-4 py-2 text-sm bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return <div ref={editorRef} className="h-full" />;
}
