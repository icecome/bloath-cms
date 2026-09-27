import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';

interface MediaUploaderProps {
  uploading: boolean;
  quality: number;
  onUpload: (files: FileList | File[]) => void;
}

export function MediaUploader({ uploading, quality, onUpload }: MediaUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="上传图片：点击选择或拖拽文件到此处"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files);
      }}
      onClick={() => fileInputRef.current?.click()}
      onKeyDown={(e) => {
        // 内层 input 为 display:none 无法聚焦，键盘用户通过外层触发文件选择
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        dragOver
          ? 'border-primary bg-blue-50'
          : 'border-border hover:border-border hover:bg-accent'
      } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onUpload(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />
      {uploading ? (
        <Loader2 className="w-8 h-8 text-primary mx-auto mb-2 animate-spin" />
      ) : (
        <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
      )}
      <p className="text-sm text-muted-foreground">
        {uploading ? '上传中...' : '拖拽图片到此处，或点击选择文件'}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        自动压缩为 WebP · 质量 {quality}% · 自动重命名
      </p>
    </div>
  );
}
