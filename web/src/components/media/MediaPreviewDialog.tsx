import { X, Copy, Check, Trash2 } from 'lucide-react';
import type { MediaFile } from '../../lib/mediaUtils';
import { formatSize, formatDate } from '../../lib/mediaUtils';
import Modal from '../ui/Modal';

interface MediaPreviewDialogProps {
  file: MediaFile | null;
  copiedId: string | null;
  copiedType: 'url' | 'markdown' | null;
  onClose: () => void;
  onCopyUrl: (file: MediaFile) => void;
  onCopyMarkdown: (file: MediaFile) => void;
  onDelete: (file: MediaFile) => void;
}

export function MediaPreviewDialog({
  file, copiedId, copiedType, onClose, onCopyUrl, onCopyMarkdown, onDelete
}: MediaPreviewDialogProps) {
  if (!file) return null;

  return (
    <Modal
      ariaLabel={`预览 ${file.name}`}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      className="bg-card rounded-sm max-w-3xl w-full max-h-[90vh] overflow-auto"
    >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-medium text-foreground truncate font-mono">{file.name}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="关闭预览"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 flex items-center justify-center bg-accent">
          <img
            src={file.url}
            alt={file.name}
            className="max-w-full max-h-[60vh] object-contain"
          />
        </div>
        <div className="px-4 py-3 border-t border-border space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-foreground font-mono bg-accent px-2 py-1 rounded-sm truncate">
              {file.url}
            </code>
            <button
              type="button"
              onClick={() => onCopyUrl(file)}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
            >
              {copiedId === file.sha && copiedType === 'url' ? (
                <><Check className="w-3 h-3" /> 已复制</>
              ) : (
                <><Copy className="w-3 h-3" /> URL</>
              )}
            </button>
            <button
              type="button"
              onClick={() => onCopyMarkdown(file)}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
            >
              {copiedId === file.sha && copiedType === 'markdown' ? (
                <><Check className="w-3 h-3" /> 已复制</>
              ) : (
                <><span className="text-[10px] font-bold">#</span> MD</>
              )}
            </button>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatSize(file.size)} · 修改于 {formatDate(file.lastModified)}</span>
            <button
              type="button"
              onClick={() => { onDelete(file); onClose(); }}
              className="flex items-center gap-1 text-destructive hover:opacity-80 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> 删除
            </button>
          </div>
        </div>
      </Modal>
  );
}
