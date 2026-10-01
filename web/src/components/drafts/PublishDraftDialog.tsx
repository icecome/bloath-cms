// 发布草稿确认弹窗（只读）
//
// 目标路径已在「预发布」阶段确定，此处仅作最终确认，不可修改。
// 设计意图：若允许在此改目标，会绕过「未预发布不能发布」的约束，
// 使预发布形同虚设。需要改目标时请先取消预发布再重新设置。
import { AlertTriangle } from 'lucide-react';

export interface PublishConfirmEntry {
  path: string;
  name: string;
  /** 草稿当前位置（缓冲或仓库中的源路径） */
  currentPath?: string;
  /** 已预发布的目标目录 */
  previewTarget: string;
  /** 预发布后内容是否已变更 */
  stale: boolean;
}

interface Props {
  entries: PublishConfirmEntry[];
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function PublishDraftDialog({ entries, loading, onConfirm, onClose }: Props) {
  const staleEntries = entries.filter((e) => e.stale);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card rounded-lg p-5 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-foreground mb-1">
          发布 {entries.length} 篇草稿
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          以下草稿将按「发布至」列的目标路径提交。如需修改目标，请先取消预发布。
        </p>

        {staleEntries.length > 0 && (
          <div className="flex items-start gap-2 px-3 py-2 mb-3 bg-amber-50 border border-amber-200 rounded-sm">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              其中 {staleEntries.length} 篇在预发布后已被修改，目标路径可能已不适用。
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">没有可发布的草稿。</p>
          ) : (
            <div className="space-y-1">
              {entries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-start gap-2 px-3 py-2 border border-border rounded-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-foreground truncate">{entry.name}</span>
                      {entry.stale && <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />}
                    </div>
                    {entry.currentPath && (
                      <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                        当前位置：{entry.currentPath}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 max-w-[45%]">
                    <span className="text-[10px] text-muted-foreground block">发布至</span>
                    <span className="text-[11px] font-mono text-foreground break-all">
                      {entry.previewTarget || '（未指定）'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-accent rounded-sm transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || entries.length === 0}
            className="px-4 py-2 text-sm text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '发布中……' : '确认发布'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PublishDraftDialog;
