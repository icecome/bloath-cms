export default function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-border border-t-primary"></div>
        <span className="text-xs">加载中...</span>
      </div>
    </div>
  );
}
