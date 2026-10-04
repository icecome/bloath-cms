import type { MediaFile } from '../../lib/mediaUtils';
import Modal from '../ui/Modal';

interface DeleteConfirmDialogProps {
  file: MediaFile | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({ file, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  if (!file) return null;

  return (
    <Modal
      ariaLabel="删除图片确认"
      onClose={onCancel}
      className="bg-card rounded-sm shadow-sm p-4 w-full max-w-sm mx-4 border border-border"
    >
      <p className="text-sm text-foreground mb-4">
        确定要删除 <span className="font-mono text-muted-foreground">{file.name}</span> 吗？该文件将从仓库中删除，且无法在媒体库中恢复。
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-border text-foreground hover:bg-accent rounded-sm transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-3 py-1.5 text-sm text-white bg-destructive hover:bg-destructive/90 rounded-sm transition-colors"
        >
          删除
        </button>
      </div>
    </Modal>
  );
}
