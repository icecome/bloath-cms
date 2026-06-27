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
  onPageChange
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-8 py-3 border-t border-[#F2F2F2]">
      <div className="text-sm text-[#6B7280]">
        显示 {(currentPage - 1) * 20 + 1} - {Math.min(currentPage * 20, totalItems)} 条，共 {totalItems} 条
      </div>
      <div className="flex items-center gap-1">
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
    </div>
  );
}
