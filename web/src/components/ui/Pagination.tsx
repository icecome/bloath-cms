import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize = 20,
  onPageChange
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between px-4 md:px-8 py-3 border-t border-[#F2F2F2]">
      {/* 信息文字 */}
      <div className="text-xs md:text-sm text-[#6B7280] truncate">
        <span className="md:hidden">{currentPage}/{totalPages} 页</span>
        <span className="hidden md:inline">显示 {start} - {end} 条，共 {totalItems} 条</span>
      </div>

      {/* 桌面端：完整按钮组 */}
      <div className="hidden md:flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="px-3 py-1.5 text-sm border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          首页
        </button>
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="px-3 py-1.5 text-sm border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          上一页
        </button>
        <span className="px-3 py-1.5 text-sm text-[#6B7280]">
          {currentPage}/{totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="px-3 py-1.5 text-sm border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          下一页
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="px-3 py-1.5 text-sm border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          末页
        </button>
      </div>

      {/* 移动端：紧凑箭头按钮 */}
      <div className="flex md:hidden items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="w-9 h-9 flex items-center justify-center border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-sm"
          aria-label="上一页"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="w-9 h-9 flex items-center justify-center border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-sm"
          aria-label="下一页"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
