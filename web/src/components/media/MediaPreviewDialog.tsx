import { X, Copy, Check, Trash2, ImageOff } from 'lucide-react';
import type { MediaFile } from '../../lib/mediaUtils';
import { formatSize, formatDate, isVideoName } from '../../lib/mediaUtils';
import { cdnImageErrorHandler } from '../../lib/cdnFallback';
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

  const isVideo = isVideoName(file.name);

  return (
    <Modal
      ariaLabel={`预览 ${file.name}`}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      className="bg-card rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto"
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
          {isVideo ? (
            // preload=metadata 只取头部，不预下载全片。
            // 能否拖动进度取决于服务端是否支持 Range（见设计方案 §3.3）
            <video
              src={file.url}
              controls
              preload="metadata"
              playsInline
              className="max-w-full max-h-[60vh] bg-black"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2">
              <img
                src={file.url}
                alt={file.name}
                className="max-w-full max-h-[60vh] object-contain"
                onError={(e) =>
                  // 全部候选域失败时显示友好占位，避免预览区完全空白。
                  // 占位 div 靠 flex 布局：remove('hidden') 后必须补 add('flex')，
                  // 否则 display 回落为 block，flex-col/items-center 全部失效
                  cdnImageErrorHandler(e, (img) => {
                    const holder = img.nextElementSibling;
                    if (holder instanceof HTMLElement) {
                      holder.classList.remove('hidden');
                      holder.classList.add('flex');
                    }
                  })
                }
              />
              {/* 占位：默认 hidden；CDN 全失败时由 onGiveUp 切换为 flex 显示 */}
              <div className="hidden flex-col items-center gap-2 py-8 text-muted-foreground">
                <ImageOff className="w-10 h-10" />
                <p className="text-xs">图片加载失败，所有 CDN 源均不可用</p>
                <code className="text-[11px] font-mono text-muted-foreground/70 max-w-full break-all px-4">{file.url}</code>
              </div>
            </div>
          )}
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
                <><span className="text-[10px] font-bold">#</span> {isVideo ? '嵌入代码' : 'MD'}</>
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
