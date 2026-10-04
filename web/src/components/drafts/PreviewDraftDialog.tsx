// 预发布草稿弹窗：逐项指定目标目录（或整批统一）
//
// 与 PublishDraftDialog 的差异：
// - 目标不允许为空（预发布的全部价值就是固化「发到哪里」）
// - 不产生任何提交，仅标记目标（本地记录 + 缓冲 publishTarget）
import { useEffect, useState } from 'react';
import { Layers, ListTree } from 'lucide-react';
import { DirectoryTreePicker } from './DirectoryTreePicker';
import Modal from '../ui/Modal';
import type { DirNode } from '../../lib/dirTree';

export interface PreviewTargetEntry {
  path: string;
  name: string;
}

interface Props {
  /** 待预发布的草稿条目（自动排除已预发布项） */
  entries: PreviewTargetEntry[];
  /** 被跳过（已预发布）的条目数，仅用于文案提示 */
  skippedCount?: number;
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

export function PreviewDraftDialog({
  entries, skippedCount = 0, dirNodes, loading, targets, onTargetsChange, onConfirm, onClose,
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
  // 预发布要求每一项都有明确目标，空目标不允许确认
  const allTargetsFilled = entries.length > 0 && entries.every((e) => effectiveTargets[e.path]?.trim());

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
    if (!allTargetsFilled) return;
    if (mode === 'batch') {
      const next: Record<string, string> = {};
      for (const e of entries) next[e.path] = batchTarget;
      onTargetsChange(next);
    }
    // 由 onConfirm 负责关闭，避免先关后确认导致状态被清掉
    onConfirm();
  };

  return (
    <Modal
      ariaLabel="预发布草稿"
      onClose={onClose}
      className="bg-card rounded-lg p-5 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
    >
        <h3 className="text-lg font-medium text-foreground mb-1">
          预发布 {entries.length} 篇草稿
        </h3>
        <p className="text-xs text-muted-foreground mb-1">
          预发布仅标记目标位置，不会产生提交；确认后还需点击「发布」或「发布变更」，才会移至目标目录。
        </p>
        {skippedCount > 0 && (
          <p className="text-xs text-muted-foreground mb-2">已跳过 {skippedCount} 篇已预发布的草稿。</p>
        )}

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
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              选中的草稿均已完成预发布，无需重复操作。
            </p>
          ) : mode === 'batch' ? (
            <div>
              <DirectoryTreePicker
                nodes={dirNodes}
                value={batchTarget}
                onChange={applyBatch}
                placeholder="如 content/posts/sub"
              />
              <p className="text-xs text-muted-foreground mt-1">预发布必须指定目标目录</p>
            </div>
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
                      <span className={`text-[11px] truncate max-w-[45%] ${current.trim() ? 'text-muted-foreground' : 'text-destructive'}`}>
                        {current.trim() || '未指定'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-border-subtle pt-2">
                        <DirectoryTreePicker
                          nodes={dirNodes}
                          value={current}
                          onChange={(v) => setOne(entry.path, v)}
                          placeholder="必须指定目标目录"
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
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-muted-foreground hover:bg-accent rounded-sm transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || entries.length === 0 || !allTargetsFilled}
            className="px-4 py-2 text-sm text-white bg-foreground rounded-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={allTargetsFilled ? undefined : '请为所有草稿指定目标目录'}
          >
            {loading ? '处理中……' : '确认预发布'}
          </button>
        </div>
    </Modal>
  );
}

export default PreviewDraftDialog;
