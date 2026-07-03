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
          onReady?.(instance);
        },
        input: (val: string) => {
          onInput?.(val);
        }
      });
      vditorRef.current = instance;
    } catch (err) {
      console.error('Vditor 初始化失败:', err);
    }
  }, [onInput, onReady]);

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
