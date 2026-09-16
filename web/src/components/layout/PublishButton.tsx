import { useBuffer } from '../../contexts/BufferContext';
import { useAuth } from '../../hooks/useAuth';
import { Upload, Loader2, X, FileText, FilePlus2, FileMinus } from 'lucide-react';
import type { BufferOp } from '../../lib/bufferApi';

const OP_META: Record<BufferOp, { label: string; icon: React.ReactNode; className: string }> = {
  write: { label: '新增/修改', icon: <FileText className="w-3 h-3" />, className: 'text-blue-600' },
  delete: { label: '删除', icon: <FileMinus className="w-3 h-3" />, className: 'text-red-600' },
  move: { label: '移动', icon: <FilePlus2 className="w-3 h-3" />, className: 'text-orange-600' },
};

function PublishDialog() {
  const { changes, changesCount, publishing, publish, setShowPublishDialog } = useBuffer();
  const { user } = useAuth();

  const handleConfirm = async () => {
    await publish(user?.login);
    setShowPublishDialog(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPublishDialog(false)}>
      <div className="bg-card border border-border rounded-sm w-full max-w-lg mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">发布 {changesCount} 项变更</h3>
          <button type="button" onClick={() => setShowPublishDialog(false)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 max-h-80 overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-3">
            以下缓冲变更将合并为一次提交推送至 GitHub（触发一次 CI 部署），发布后缓冲文件立即清理。
          </p>
          <div className="space-y-1">
            {changes.map((item) => {
              const meta = OP_META[item.op] || OP_META.write;
              return (
                <div key={`${item.op}-${item.path}`} className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-accent/50">
                  <span className={meta.className}>{meta.icon}</span>
                  <span className="text-[10px] text-muted-foreground w-14 flex-shrink-0">{meta.label}</span>
                  <code className="text-[11px] text-foreground font-mono truncate flex-1" title={item.path}>
                    {item.path}
                  </code>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={() => setShowPublishDialog(false)}
            className="px-3 py-1.5 text-xs border border-border rounded-sm hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={publishing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors"
          >
            {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {publishing ? '发布中...' : '确认发布'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PublishButton() {
  const { config, changesCount, publishing, showPublishDialog, setShowPublishDialog } = useBuffer();

  if (!config?.enabled) return null;

  return (
    <>
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => setShowPublishDialog(true)}
          disabled={changesCount === 0 || publishing}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-sm text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors relative"
        >
          {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          <span>发布变更</span>
          {changesCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-medium bg-blue-600 text-white rounded-full">
              {changesCount > 99 ? '99+' : changesCount}
            </span>
          )}
        </button>
      </div>
      {showPublishDialog && <PublishDialog />}
    </>
  );
}
