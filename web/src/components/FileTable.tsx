import type { ReactNode } from 'react';
import type { EnhancedFileItem, FileSource } from '../lib/extractFrontMatter';

const SOURCE_META: Record<FileSource, { label: string; className: string }> = {
  repo: { label: '仓库', className: 'bg-secondary text-muted-foreground' },
  buffer: { label: '缓存', className: 'bg-orange-100 text-orange-700' },
  'buffer-modified': { label: '缓存·有改动', className: 'bg-orange-100 text-orange-700' },
  'buffer-deleted': { label: '缓存·待删除', className: 'bg-red-100 text-red-700' },
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
  renderDesktopActions,
  renderMobileActions,
}: FileTableProps) {
  return (
    <div>
      <div className="hidden md:flex items-center py-3 px-4 text-sm font-medium text-muted-foreground bg-accent border-b border-border">
        <div className="w-8 flex items-center justify-center">
          <input
            type="checkbox"
            checked={selectedFiles.size === filteredCount && filteredCount > 0}
            onChange={onSelectAll}
            className="w-4 h-4 rounded-sm border-border bg-card text-primary focus:ring-primary"
          />
        </div>
        <div className={nameColumnWidth}>文件名</div>
        <div className={pathColumnWidth}>路径</div>
        {showSource && <div className="w-[12%]">来源</div>}
        <div className={showSource ? 'flex-1 text-right' : 'w-[20%] text-right'}>操作</div>
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
          <div className={`hidden md:flex items-center ${nameColumnWidth} gap-2.5 px-3`}>
            {rowIcon}
            <span className="text-sm text-foreground truncate">
              {file.name.replace('.md', '')}
            </span>
          </div>
          <div className={`hidden md:block ${pathColumnWidth} px-3`}>
            <span className="text-sm text-muted-foreground truncate block">{file.path}</span>
          </div>
          {showSource && (
            <div className="hidden md:flex w-[12%] items-center px-3">
              <SourceBadge file={file} />
            </div>
          )}
          <div className={`hidden md:flex ${showSource ? 'flex-1' : 'w-[20%]'} items-center justify-end gap-2 px-3`}>
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
                {file.path}
              </div>
            </div>
            {showSource && <SourceBadge file={file} />}
            <div className="flex items-center gap-1 flex-shrink-0">
              {renderMobileActions(file)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
