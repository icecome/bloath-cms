import type { ReactNode } from 'react';
import type { EnhancedFileItem, FileSource } from '../lib/extractFrontMatter';
import type { DraftPreviewState } from '../lib/draftPreviewStore';

const SOURCE_META: Record<FileSource, { label: string; className: string }> = {
  repo: { label: '仓库', className: 'bg-secondary text-muted-foreground' },
  buffer: { label: '缓冲', className: 'bg-orange-100 text-orange-700' },
  'buffer-modified': { label: '缓冲·有改动', className: 'bg-orange-100 text-orange-700' },
  'buffer-deleted': { label: '缓冲·待删除', className: 'bg-red-100 text-red-700' },
};

// 预发布状态徽标：draft 不显示徽标（避免噪声），仅在有预发布动作时提示
const PREVIEW_META: Record<Exclude<DraftPreviewState, 'draft'>, { label: string; className: string }> = {
  previewed: { label: '已预发布', className: 'bg-blue-100 text-blue-700' },
  'preview-stale': { label: '预发布过期', className: 'bg-amber-100 text-amber-700' },
};

function SourceBadge({ file }: { file: EnhancedFileItem }) {
  const source = file.source ?? 'repo';
  const meta = SOURCE_META[source];
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm flex-shrink-0 ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function PreviewBadge({ state }: { state: DraftPreviewState }) {
  if (state === 'draft') return null;
  const meta = PREVIEW_META[state];
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm flex-shrink-0 ${meta.className}`}>
      {meta.label}
    </span>
  );
}

// 缓冲文件不在仓库中，不展示仓库草稿目录前缀，避免误读为已存在于仓库
function displayPath(file: EnhancedFileItem, draftPath: string): string {
  const isBuffered = !!file.source && file.source !== 'repo';
  if (!isBuffered || !draftPath) return file.path;
  const prefix = draftPath.replace(/\/+$/, '') + '/';
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
}

/** 预发布路径列的显示文本与样式 */
function previewPathDisplay(file: EnhancedFileItem): { text: string; className: string } {
  const state = file.previewState ?? 'draft';
  if (state === 'draft' || !file.previewTarget) {
    return { text: '—', className: 'text-muted-foreground' };
  }
  if (state === 'preview-stale') {
    return { text: `${file.previewTarget} ⚠`, className: 'text-amber-700' };
  }
  return { text: file.previewTarget, className: 'text-foreground' };
}

interface FileTableProps {
  files: EnhancedFileItem[];
  selectedFiles: Set<string>;
  filteredCount: number;
  onSelectAll: () => void;
  onSelectFile: (path: string) => void;
  onRowClick?: (file: EnhancedFileItem) => void;
  rowIcon: ReactNode;
  nameColumnWidth: string;
  pathColumnWidth: string;
  /** 是否显示来源列 */
  showSource?: boolean;
  /** 草稿目录前缀，用于缓冲项路径的去前缀展示 */
  draftPath?: string;
  /** 是否显示预发布路径列（仅草稿箱使用） */
  showPreviewPath?: boolean;
  /** 点击预发布路径列的回调（用于修改目标） */
  onPreviewPathClick?: (file: EnhancedFileItem) => void;
  renderDesktopActions: (file: EnhancedFileItem) => ReactNode;
  renderMobileActions: (file: EnhancedFileItem) => ReactNode;
}

export default function FileTable({
  files,
  selectedFiles,
  filteredCount,
  onSelectAll,
  onSelectFile,
  onRowClick,
  rowIcon,
  nameColumnWidth,
  pathColumnWidth,
  showSource = false,
  draftPath = '',
  showPreviewPath = false,
  onPreviewPathClick,
  renderDesktopActions,
  renderMobileActions,
}: FileTableProps) {
  return (
    <div>
      <div className="hidden md:flex items-center py-3 px-4 text-sm font-medium text-muted-foreground bg-accent border-b border-border">
        <div className="w-8 flex items-center justify-center shrink-0">
          <input
            type="checkbox"
            checked={selectedFiles.size === filteredCount && filteredCount > 0}
            onChange={onSelectAll}
            className="w-4 h-4 rounded-sm border-border bg-card text-primary focus:ring-primary"
          />
        </div>
        <div className={`${nameColumnWidth} shrink-0`}>文件名</div>
        <div className={`${pathColumnWidth} shrink-0`}>路径</div>
        {showPreviewPath && <div className="w-[18%] px-3 shrink-0">预发布路径</div>}
        {showSource && <div className={showPreviewPath ? 'w-[14%] px-3 shrink-0' : 'w-[12%] shrink-0'}>来源</div>}
        {/* 操作列固定最小宽度并禁止压缩：否则 flex-1 会把它压到内容最小尺寸以下导致按钮文字换行 */}
        <div className="flex-1 min-w-[170px] shrink-0 text-right">操作</div>
      </div>

      {files.map((file) => (
        <div
          key={file.path}
          className={`flex items-center px-4 py-3.5 border-b border-border-subtle transition-colors hover:bg-accent ${
            selectedFiles.has(file.path) ? 'bg-accent' : ''
          }`}
          onClick={(e) => {
            if (!onRowClick) return;
            if ((e.target as HTMLElement).closest('input[type="checkbox"]') ||
                (e.target as HTMLElement).closest('button')) return;
            onRowClick(file);
          }}
        >
          <div className="hidden md:flex items-center w-8 justify-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selectedFiles.has(file.path)}
              onChange={() => onSelectFile(file.path)}
              className="w-4 h-4 rounded-sm border-border bg-card text-primary focus:ring-primary"
            />
          </div>
          <div className={`hidden md:flex items-center ${nameColumnWidth} shrink-0 gap-2.5 px-3`}>
            {rowIcon}
            <span className="text-sm text-foreground truncate">
              {file.name.replace('.md', '')}
            </span>
          </div>
          <div className={`hidden md:block ${pathColumnWidth} shrink-0 px-3`}>
            <span className="text-sm text-muted-foreground truncate block" title={file.path}>
              {displayPath(file, draftPath)}
            </span>
          </div>
          {showPreviewPath && (
            <div className="hidden md:block w-[18%] px-3 shrink-0">
              {(() => {
                const { text, className } = previewPathDisplay(file);
                const clickable = !!onPreviewPathClick;
                return clickable ? (
                  <button
                    type="button"
                    onClick={() => onPreviewPathClick(file)}
                    title={text}
                    className={`text-sm truncate block max-w-full text-left hover:underline ${className}`}
                  >
                    {text}
                  </button>
                ) : (
                  <span className={`text-sm truncate block ${className}`} title={text}>{text}</span>
                );
              })()}
            </div>
          )}
          {showSource && (
            <div className={`hidden md:flex items-center gap-1 px-3 shrink-0 ${showPreviewPath ? 'w-[14%]' : 'w-[12%]'}`}>
              <SourceBadge file={file} />
              <PreviewBadge state={file.previewState ?? 'draft'} />
            </div>
          )}
          <div className={`hidden md:flex ${showSource || showPreviewPath ? 'flex-1 min-w-[170px] shrink-0' : 'w-[20%]'} items-center justify-end gap-2 px-3`}>
            {renderDesktopActions(file)}
          </div>

          <div className="flex md:hidden flex-1 min-w-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selectedFiles.has(file.path)}
              onChange={() => onSelectFile(file.path)}
              className="w-4 h-4 rounded-sm border-border bg-card text-primary focus:ring-primary flex-shrink-0"
            />
            {rowIcon}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">
                {file.name.replace('.md', '')}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {displayPath(file, draftPath)}
              </div>
              {showPreviewPath && (file.previewState ?? 'draft') !== 'draft' && (
                <div className="text-xs truncate mt-0.5">
                  <span className={previewPathDisplay(file).className}>
                    → {previewPathDisplay(file).text}
                  </span>
                </div>
              )}
            </div>
            {showSource && (
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <SourceBadge file={file} />
                <PreviewBadge state={file.previewState ?? 'draft'} />
              </div>
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              {renderMobileActions(file)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
