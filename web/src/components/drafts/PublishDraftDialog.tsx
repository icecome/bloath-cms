// 发布草稿弹窗（P1-002 单键发布）
//
// 原两步流要求「先预发布固化目标 → 再确认发布」，用户需理解两个概念且被
// 禁用态卡住。本弹窗改为：目标在发布确认时内联指定（逐篇或整批统一），
// 确认即一步完成「固化目标 + 移动发布」。原两步流保留为「高级」入口
// （仅标记目标、稍后发布，见底部链接与 onAdvanced 回调）。
import { useEffect, useState } from 'react';
import { AlertTriangle, Layers, ListTree } from 'lucide-react';
import { DirectoryTreePicker } from './DirectoryTreePicker';
import Modal from '../ui/Modal';
import type { DirNode } from '../../lib/dirTree';

export interface PublishConfirmEntry {
  path: string;
  name: string;
  /** 草稿当前位置（缓冲或仓库中的源路径） */
  currentPath?: string;
  /** 既有预发布目标（用于预填，可修改） */
  previewTarget: string;
  /** 预发布后内容是否已变更（preview-stale） */
  stale: boolean;
}

interface Props {
  entries: PublishConfirmEntry[];
  /** 目录树根节点（与 PreviewDraftDialog 共用同一份 fetchDirTree 结果） */
  dirNodes: DirNode[];
  loading: boolean;
  /** 逐项目标：path -> target（受控于 DraftsPage，确认时随 onConfirm 传出） */
  targets: Record<string, string>;
  onTargetsChange: (next: Record<string, string>) => void;
  /** 单键发布：固化目标并立即发布（一次操作完成） */
  onConfirm: (targets: Record<string, string>) => void;
  /** 高级两步流：仅固化目标不发布（保留原「先标记、稍后发布」选项） */
  onAdvanced: (targets: Record<string, string>) => void;
  onClose: () => void;
}

type Mode = 'batch' | 'perItem';

// preview-stale 行内警示样式：与 FileTable PREVIEW_META 的预发布过期徽标同色
const STALE_ROW_CLASS = 'bg-warning/10 text-warning';

export function PublishDraftDialog({
  entries, dirNodes, loading, targets, onTargetsChange, onConfirm, onAdvanced, onClose,
}: Props) {
  const [mode, setMode] = useState<Mode>(entries.length > 1 ? 'batch' : 'perItem');
  const [batchTarget, setBatchTarget] = useState('');
  const [expandedPath, setExpandedPath] = useState<string | null>(
    entries.length === 1 ? entries[0]?.path ?? null : null
  );

  // 单篇时直接进入逐项模式，避免多余的切换（与 PreviewDraftDialog 一致）
  useEffect(() => {
    if (entries.length === 1) setMode('perItem');
  }, [entries.length]);

  const effectiveTargets: Record<string, string> = {};
  for (const e of entries) {
    effectiveTargets[e.path] = mode === 'batch' ? batchTarget : (targets[e.path] || '');
  }
  // 发布必须每一项都有明确目标，否则 moveOps 会静默跳过空目标条目
  const allTargetsFilled = entries.length > 0 && entries.every((e) => effectiveTargets[e.path]?.trim());
  const staleCount = entries.filter((e) => e.stale).length;

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

  /** 确认前的目标表收敛：batch 模式下把统一目标写回逐项表，再交给回调 */
  const resolveTargets = (): Record<string, string> => {
    if (mode !== 'batch') return targets;
    const next: Record<string, string> = {};
    for (const e of entries) next[e.path] = batchTarget;
    onTargetsChange(next);
    return next;
  };

  const handleConfirm = () => {
    if (!allTargetsFilled) return;
    // 由父组件负责关闭，避免先关后确认导致状态被清掉
    onConfirm(resolveTargets());
  };

  const handleAdvanced = () => {
    if (!allTargetsFilled) return;
    onAdvanced(resolveTargets());
  };

  return (
    <Modal
      ariaLabel="发布草稿"
      onClose={onClose}
      className="bg-card rounded-lg p-5 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
    >
        <h3 className="text-lg font-medium text-foreground mb-1">
          发布 {entries.length} 篇草稿
        </h3>
        <p className="text-xs text-muted-foreground mb-1">
          为每篇草稿指定目标目录，确认后将移出草稿箱并提交发布。
        </p>

        {entries.length > 1 && (
          <div className="flex items-center gap-1 mt-2 mb-3 border border-border rounded-sm p-0.5 w-fit">
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
            <p className="text-xs text-muted-foreground py-6 text-center">没有可发布的草稿。</p>
          ) : mode === 'batch' ? (
            <div>
              <DirectoryTreePicker
                nodes={dirNodes}
                value={batchTarget}
                onChange={applyBatch}
                placeholder="如 content/posts/sub"
              />
              {staleCount > 0 && (
                <div className="flex items-start gap-2 px-3 py-2 mt-2 border border-warning/25 rounded-sm">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                  <p className={`text-xs ${STALE_ROW_CLASS}`}>
                    其中 {staleCount} 篇在预发布后已被修改，目标可能需调整。
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => {
                const isOpen = expandedPath === entry.path;
                const current = targets[entry.path] || '';
                return (
                  <div key={entry.path} className={`border border-border rounded-sm ${entry.stale ? STALE_ROW_CLASS : ''}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedPath(isOpen ? null : entry.path)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <span className="text-sm text-foreground truncate flex-1 flex items-center gap-1.5">
                        {entry.name}
                        {entry.stale && <AlertTriangle className="w-3 h-3 text-warning flex-shrink-0" />}
                      </span>
                      <span className={`text-[11px] truncate max-w-[45%] ${current.trim() ? 'text-muted-foreground' : 'text-destructive'}`}>
                        {current.trim() || '未指定'}
                      </span>
                    </button>
                    {entry.stale && !isOpen && (
                      <p className="px-3 pb-2 -mt-1 text-[11px] text-warning">草稿已修改，目标可能需调整</p>
                    )}
                    {entry.currentPath && (
                      <p className="px-3 pb-2 text-[11px] font-mono text-muted-foreground truncate">
                        当前位置：{entry.currentPath}
                      </p>
                    )}
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

        {!allTargetsFilled && entries.length > 0 && (
          <p className="text-xs text-destructive mt-2">请为所有草稿指定目标目录</p>
        )}

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
            className="px-4 py-2 text-sm text-white bg-foreground rounded-sm hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={allTargetsFilled ? undefined : '请为所有草稿指定目标目录'}
          >
            {loading ? '发布中……' : '确认发布'}
          </button>
        </div>

        {/* 高级两步流入口（P1-002）：仅标记目标、稍后发布，保留给需要分步操作的用户 */}
        <div className="pt-2 mt-1 text-center">
          <button
            type="button"
            onClick={handleAdvanced}
            disabled={loading || entries.length === 0 || !allTargetsFilled}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:no-underline"
          >
            高级（分两步：先标记目标，稍后发布）
          </button>
        </div>
    </Modal>
  );
}

export default PublishDraftDialog;
