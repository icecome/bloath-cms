import type { ReactNode } from 'react';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';

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
  renderDesktopActions,
  renderMobileActions,
}: FileTableProps) {
  return (
    <div>
      {/* 桌面端表头 */}
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
        <div className="w-[20%] text-right">操作</div>
      </div>

      {/* 列表 */}
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
          {/* 桌面端：表格行 */}
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
          <div className="hidden md:flex w-[20%] items-center justify-end gap-2 px-3">
            {renderDesktopActions(file)}
          </div>

          {/* 移动端：卡片布局 */}
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
            <div className="flex items-center gap-1 flex-shrink-0">
              {renderMobileActions(file)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
