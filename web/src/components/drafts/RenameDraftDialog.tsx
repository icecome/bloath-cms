interface Props {
  value: string;
  loading: boolean;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function RenameDraftDialog({ value, loading, onChange, onConfirm, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card rounded-lg p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-foreground mb-4">重命名草稿</h3>
        <div className="mb-4">
          <label className="block text-sm text-muted-foreground mb-2">新文件名（不含 .md）</label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border bg-card text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus:border-primary transition-colors"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm();
              if (e.key === 'Escape') onClose();
            }}
          />
          <p className="text-xs text-muted-foreground mt-1">仅修改文件名，不修改 frontmatter</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-accent rounded-sm transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!value.trim() || loading}
            className="px-4 py-2 text-sm text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '处理中...' : '确认重命名'}
          </button>
        </div>
      </div>
    </div>
  );
}
