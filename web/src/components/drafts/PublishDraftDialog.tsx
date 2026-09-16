interface Props {
  selectedCount: number;
  availableDirs: string[];
  publishTarget: string;
  loading: boolean;
  onTargetChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function PublishDraftDialog({
  selectedCount, availableDirs, publishTarget, loading,
  onTargetChange, onConfirm, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card rounded-lg p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-foreground mb-4">发布 {selectedCount} 篇草稿</h3>
        <div className="mb-4">
          <p className="text-sm text-muted-foreground mb-2">发布到目标目录：</p>
          <div className="space-y-0.5 mb-3">
            {availableDirs.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1">暂无可用目录</p>
            ) : (
              availableDirs.map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => onTargetChange(dir)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent rounded-sm transition-colors ${
                    publishTarget === dir ? 'text-foreground font-medium bg-accent' : 'text-muted-foreground'
                  }`}
                >
                  {publishTarget === dir && <span className="text-green-500">✓</span>}
                  <span className="truncate">{dir}</span>
                </button>
              ))
            )}
          </div>
          <label className="block text-sm text-muted-foreground mb-1">或输入自定义路径</label>
          <input
            type="text"
            value={publishTarget}
            onChange={(e) => onTargetChange(e.target.value)}
            placeholder="如 content/posts/sub"
            className="w-full px-3 py-2 text-sm border border-border bg-card text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-accent rounded-sm transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => { onClose(); onConfirm(); }}
            disabled={!publishTarget.trim() || loading}
            className="px-4 py-2 text-sm text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '发布中...' : '确认发布'}
          </button>
        </div>
      </div>
    </div>
  );
}
