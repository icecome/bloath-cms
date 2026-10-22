import { useEffect } from 'react';
import type { MediaFile } from '../../lib/mediaUtils';
import type { AssetReference } from '../../lib/assetReferences';
import Modal from '../ui/Modal';

interface DeleteConfirmDialogProps {
  file: MediaFile | null;
  /** 删除前引用检查结果：null=未检查；空数组=无引用；非空=有引用需警示 */
  references: AssetReference[] | null;
  /** 引用检查进行中 */
  checking: boolean;
  /** 对话框打开时触发一次引用检查 */
  onCheck: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({ file, references, checking, onCheck, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  // 打开对话框即触发一次引用检查（file 变化时重查）
  useEffect(() => {
    if (file) onCheck();
  }, [file, onCheck]);

  if (!file) return null;

  return (
    <Modal
      ariaLabel="删除图片确认"
      onClose={onCancel}
      className="bg-card rounded-sm shadow-sm p-4 w-full max-w-md mx-4 border border-border"
    >
      <p className="text-sm text-foreground mb-3">
        确定要删除 <span className="font-mono text-muted-foreground">{file.name}</span> 吗？该文件将从仓库中删除，且无法在媒体库中恢复。
      </p>

      {/* 引用检查结果区：检查中 / 有引用警示 / 无引用 */}
      {checking && (
        <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          正在检查文章引用……
        </p>
      )}
      {!checking && references && references.length > 0 && (
        <div className="mb-3 border border-amber-300 bg-amber-50 rounded-sm p-2.5" role="alert">
          <p className="text-xs font-medium text-amber-800 mb-1.5">
            有 {references.length} 篇文章正在引用这张图片，删除后它们会出现无法显示的图片：
          </p>
          <ul className="text-xs text-amber-800 space-y-0.5 max-h-32 overflow-y-auto">
            {references.slice(0, 10).map((ref) => (
              <li key={ref.path} className="truncate">
                {ref.title}
                <span className="text-amber-600 ml-1">（{ref.where === 'frontmatter' ? '封面/元数据' : '正文'}）</span>
              </li>
            ))}
            {references.length > 10 && (
              <li className="text-amber-600">…等共 {references.length} 篇</li>
            )}
          </ul>
        </div>
      )}
      {!checking && references && references.length === 0 && (
        <p className="text-xs text-muted-foreground mb-3">未发现文章引用此图片。</p>
      )}

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
