export default function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-[#6B7280]">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#E8E8E8] border-t-[#3B82F6]"></div>
        <span className="text-xs">加载中...</span>
      </div>
    </div>
  );
}
