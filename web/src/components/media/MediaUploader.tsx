import { useRef, useState } from 'react';
import { Upload, Loader2, Minimize2, FileImage } from 'lucide-react';
import type { UploadMode } from '../../../../shared/types';

interface MediaUploaderProps {
  uploading: boolean;
  /** 压缩质量（仅压缩模式生效，用于文案） */
  quality: number;
  /** 当前上传方式（受控：由 MediaPage 持有，默认取设置页配置） */
  mode: UploadMode;
  onModeChange: (mode: UploadMode) => void;
  onUpload: (files: FileList | File[]) => void;
  /** 视频体积上限说明（GitHub 与 S3 不同，由调用方给出已格式化文案） */
  videoLimitHint?: string;
  /** 拖入内容全部无法识别时回调（由调用方弹错误提示；不传则维持旧行为） */
  onDropRejected?: () => void;
}

/** 可接受的扩展名：不用 image/*,video/*，因为要排除 mkv/avi 这类「选进来必然被拒」的格式 */
const ACCEPT = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif',
  '.mp4', '.m4v', '.webm', '.ogv', '.mov',
].join(',');

const MODES: Array<{ value: UploadMode; label: string; icon: typeof Minimize2 }> = [
  { value: 'compress', label: '压缩', icon: Minimize2 },
  { value: 'original', label: '原图', icon: FileImage },
];

export function MediaUploader({
  uploading, quality, mode, onModeChange, onUpload, videoLimitHint, onDropRejected,
}: MediaUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = () => fileInputRef.current?.click();

  return (
    <div className="border-2 border-dashed border-border rounded-sm">
      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-label="上传媒体：点击选择或拖拽文件到此处"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          // 拖入整个文件夹时 items 会包含目录条目（size=0 且无 type）：
          // 直接交出 files 会产生若干条无意义的「无法识别」错误
          const files = Array.from(e.dataTransfer.files).filter((f) => f.type !== '' || f.size > 0);
          if (files.length > 0) {
            onUpload(files);
          } else {
            // 全被过滤（拖入文件夹/不识别类型）时必须给可见反馈，不能静默吞掉（P1-005）
            onDropRejected?.();
          }
        }}
        onClick={openPicker}
        onKeyDown={(e) => {
          // 内层 input 为 display:none 无法聚焦，键盘用户通过外层触发
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        className={`p-8 text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-t-sm ${
          dragOver ? 'bg-primary/5' : 'hover:bg-accent'
        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
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
          {uploading ? '上传中……' : '拖拽图片或视频到此处，或点击选择文件'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          图片 JPG / PNG / GIF / WebP / SVG / AVIF
          {videoLimitHint ? ` · 视频 MP4 / WebM / OGV（${videoLimitHint}）` : ''}
        </p>
      </div>

      {/* 上传方式：分段控件。默认值来自设置页，本次切换不写回配置（D2） */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 border-t border-border bg-accent/40 rounded-b-sm">
        <span className="text-xs text-muted-foreground" id="upload-mode-label">上传方式</span>
        <div role="radiogroup" aria-labelledby="upload-mode-label" className="flex items-center gap-1">
          {MODES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              disabled={uploading}
              onClick={() => onModeChange(value)}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs border rounded-sm transition-colors disabled:opacity-50 disabled:pointer-events-none ${
                mode === value
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {mode === 'compress'
            ? `图片转 WebP，质量 ${quality}%，最长边 4096px；视频不压缩`
            : '保留原始格式与画质，体积更大、页面加载更慢；GIF / SVG 恒按原图'}
        </span>
      </div>
    </div>
  );
}
