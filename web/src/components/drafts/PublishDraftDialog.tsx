// 发布草稿弹窗：逐项指定目标，支持整批同一目标
import { useEffect, useState } from 'react';
import { Layers, ListTree } from 'lucide-react';
import { DirectoryTreePicker } from './DirectoryTreePicker';
import type { DirNode } from '../../lib/dirTree';

export interface PublishTargetEntry {
  path: string;
  name: string;
}

interface Props {
  /** 待发布的草稿条目（来自统一列表的选中项） */
  entries: PublishTargetEntry[];
  /** 目录树根节点 */
  dirNodes: DirNode[];
  loading: boolean;
  /** 逐项目标：path -> target */
  targets: Record<string, string>;
  onTargetsChange: (next: Record<string, string>) => void;
  onConfirm: () => void;
  onClose: () => void;
}

type Mode = 'batch' | 'perItem';

export function PublishDraftDialog({
  entries, dirNodes, loading, targets, onTargetsChange, onConfirm, onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>(entries.length > 1 ? 'batch' : 'perItem');
  const [batchTarget, setBatchTarget] = useState('');
  const [expandedPath, setExpandedPath] = useState<string | null>(
    entries.length === 1 ? entries[0]?.path ?? null : null
  );

  // 单篇时直接进入逐项模式，避免多余的切换
  useEffect(() => {
    if (entries.length === 1) setMode('perItem');
  }, [entries.length]);

  const effectiveTargets: Record<string, string> = {};
  for (const e of entries) {
    effectiveTargets[e.path] = mode === 'batch' ? batchTarget : (targets[e.path] || '');
  }
  const hasAnyTarget = entries.some((e) => effectiveTargets[e.path]?.trim());

  const applyBatch = (v: string) => {
    setBatchTarget(v);
    if (mode === 'batch') {
      const next: Record<string, string> = {};
      for (const e of entries) next[e.path] = v;
      onTargetsChange(next);
    }
  };

  const setOne = (path: string, v: string) => {
    onTargetsChange({ ...targets, [path]: v });
  };

  const handleConfirm = () => {
    if (mode === 'batch') {
      const next: Record<string, string> = {};
      for (const e of entries) next[e.path] = batchTarget;
      onTargetsChange(next);
    }
    onClose();
    onConfirm();
  };

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
          未指定目标的文章将发布到草稿目录。
        </p>

        {entries.length > 1 && (
          <div className="flex items-center gap-1 mb-3 border border-border rounded-sm p-0.5 w-fit">
            <button
              type="button"
              onClick={() => setMode('batch')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors ${
                mode === 'batch' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Layers className="w-3 h-3" />
              统一目标
            </button>
            <button
              type="button"
              onClick={() => setMode('perItem')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-sm transition-colors ${
                mode === 'perItem' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ListTree className="w-3 h-3" />
              逐篇指定
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {mode === 'batch' ? (
            <DirectoryTreePicker
              nodes={dirNodes}
              value={batchTarget}
              onChange={applyBatch}
              placeholder="如 content/posts/sub"
            />
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => {
                const isOpen = expandedPath === entry.path;
                const current = targets[entry.path] || '';
                return (
                  <div key={entry.path} className="border border-border rounded-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedPath(isOpen ? null : entry.path)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <span className="text-sm text-foreground truncate flex-1">{entry.name}</span>
                      <span className="text-[11px] text-muted-foreground truncate max-w-[45%]">
                        {current || '草稿目录'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-border-subtle pt-2">
                        <DirectoryTreePicker
                          nodes={dirNodes}
                          value={current}
                          onChange={(v) => setOne(entry.path, v)}
                          placeholder="留空则发布到草稿目录"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-border">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-accent rounded-sm transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={hasAnyTarget ? undefined : '未指定目标，将发布到草稿目录'}
          >
            {loading ? '发布中...' : '确认发布'}
          </button>
        </div>
      </div>
    </div>
  );
}
