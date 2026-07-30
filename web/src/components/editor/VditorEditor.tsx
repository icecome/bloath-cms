import { useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

interface VditorEditorProps {
  initialContent?: string;
  onInput?: (value: string) => void;
  onReady?: (instance: Vditor) => void;
}

export default function VditorEditor({ initialContent, onInput, onReady }: VditorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  const contentRef = useRef(initialContent);
  contentRef.current = initialContent;
  // 使用 ref 持有最新回调，避免 Vditor 初始化时绑定的闭包捕获过期引用
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const initializeVditor = useCallback(() => {
    if (!editorRef.current || vditorRef.current) return;

    try {
      const instance = new Vditor(editorRef.current, {
        height: '100%',
        mode: 'ir',
        placeholder: '开始编写 Markdown 内容...',
        cache: { enable: false },
        toolbarConfig: { pin: true },
        lang: 'zh_CN',
        toolbar: [
          'emoji', 'headings', 'bold', 'italic', 'strike', '|',
          'line', 'quote', 'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
          'link', 'upload', 'code', 'inline-code', '|',
          'table', 'export', 'fullscreen', 'edit-mode', 'preview', 'record', 'help'
        ],
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
      console.error('Vditor 初始化失败:', err);
    }
  }, []);

  useEffect(() => {
    return () => {
      try {
        vditorRef.current?.destroy();
      } catch {
        // Ignore destroy errors
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
