interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon, title, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center text-[#9CA3AF]">
          {icon}
        </div>
        <p className="text-sm text-[#6B7280] mb-2">{title}</p>
        {actionLabel && (
          <button
            onClick={onAction}
            className="text-sm text-[#3B82F6] hover:text-[#2563EB] font-medium"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
