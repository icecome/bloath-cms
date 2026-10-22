import { useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

interface VditorEditorProps {
  initialContent?: string;
  onInput?: (value: string) => void;
  onReady?: (instance: Vditor) => void;
}

/** 桌面端完整工具栏（现状保持不变） */
const DESKTOP_TOOLBAR = [
  'emoji', 'headings', 'bold', 'italic', 'strike', '|',
  'line', 'quote', 'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
  'link', 'upload', 'code', 'inline-code', '|',
  'table', 'export', 'fullscreen', 'edit-mode', 'preview', 'record', 'help'
] as const;

/**
 * 移动端精简工具栏（P3-6）：窄屏上完整工具栏会横向溢出，保留高频项——
 * 标题/加粗/斜体/引用/列表/链接/代码/预览切换；导出、录音、fullscreen 等低频项移除。
 */
const MOBILE_TOOLBAR = [
  'headings', 'bold', 'italic', '|',
  'quote', 'list', 'ordered-list', '|',
  'link', 'code', '|',
  'edit-mode', 'preview'
] as const;

/** 窄屏判定阈值，与 Tailwind md 断点一致 */
const MOBILE_BREAKPOINT_PX = 768;

export default function VditorEditor({ initialContent, onInput, onReady }: VditorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  const contentRef = useRef(initialContent);
  contentRef.current = initialContent;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const initializeVditor = useCallback(() => {
    if (!editorRef.current || vditorRef.current) return;

    // 初始化时按视口宽度选工具栏（编辑器生命周期内不重建，切屏后刷新生效）
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;

    try {
      const instance = new Vditor(editorRef.current, {
        height: '100%',
        mode: 'ir',
        placeholder: '开始编写 Markdown 内容……',
        cache: { enable: false },
        toolbarConfig: { pin: true },
        lang: 'zh_CN',
        toolbar: (isMobile ? MOBILE_TOOLBAR : DESKTOP_TOOLBAR) as unknown as string[],
        after: () => {
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
    }
  }, []);

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

  return <div ref={editorRef} className="h-full" />;
}
