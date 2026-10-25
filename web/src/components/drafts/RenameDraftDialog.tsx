import { useId } from 'react';
import Modal from '../ui/Modal';

interface Props {
  value: string;
  loading: boolean;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function RenameDraftDialog({ value, loading, onChange, onConfirm, onClose }: Props) {
  const titleId = useId();
  // 提交时校验：trim 后非空、不含文件系统保留字符、不以 . 结尾（Windows 下尾点会被吞）
  const trimmed = value.trim();
  const invalid =
    trimmed === '' ||
    /[/\\:*?"<>|]/.test(trimmed) ||
    trimmed.endsWith('.');

  const handleConfirm = () => {
    if (invalid || loading) return;
    onConfirm();
  };

  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className="bg-card rounded-lg p-6 w-full max-w-md mx-4"
    >
      <h3 id={titleId} className="text-lg font-medium text-foreground mb-4">重命名草稿</h3>
      <div className="mb-4">
        <label className="block text-sm text-muted-foreground mb-2">新文件名（不含 .md）</label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-3 py-2 text-sm border bg-muted text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
            invalid ? 'border-destructive' : 'border-border'
          }`}
          autoFocus
          aria-invalid={invalid || undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm();
          }}
        />
        {invalid ? (
          <p className="text-xs text-destructive mt-1" role="alert">
            文件名含非法字符或为空
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">仅修改文件名，不修改 front-matter</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm text-muted-foreground hover:bg-accent rounded-sm transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={invalid || loading}
          className="px-4 py-2 text-sm text-white bg-foreground rounded-sm hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '处理中……' : '确认重命名'}
        </button>
      </div>
    </Modal>
  );
}
