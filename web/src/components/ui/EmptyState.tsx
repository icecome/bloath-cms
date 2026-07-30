interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <p className="text-sm text-muted-foreground mb-2">{title}</p>
        {description && <p className="text-xs text-muted-foreground mb-2">{description}</p>}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="text-sm text-primary hover:text-primary font-medium"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
