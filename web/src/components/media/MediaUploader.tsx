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
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files);
      }}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors ${
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
