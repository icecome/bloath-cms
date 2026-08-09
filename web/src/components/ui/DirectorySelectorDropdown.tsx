import { Check } from 'lucide-react';
import { useState } from 'react';

interface DirectorySelectorDropdownProps {
  availableDirs: string[];
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  confirmLabel?: string;
  placeholder?: string;
  onCancel: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  variant?: 'publish' | 'restore' | 'move';
}

export default function DirectorySelectorDropdown({
  availableDirs,
  value,
  onChange,
  onConfirm,
  confirmLabel = '确认',
  placeholder = '或输入自定义路径',
  onCancel,
  disabled = false,
  isLoading = false,
  variant = 'publish'
}: DirectorySelectorDropdownProps) {
  const [customValue, setCustomValue] = useState(value);

  const handleConfirm = () => {
    onChange(customValue);
    onConfirm();
  };

  return (
    <div className="absolute top-full left-0 mt-1 bg-card border border-border z-50 min-w-[250px] p-2 shadow-lg">
      <p className="text-xs text-muted-foreground mb-2 px-1">
        {variant === 'publish' ? '发布到目标目录：' :
         variant === 'restore' ? '恢复到目标目录：' :
         '移动到：'}
      </p>
      <div className="space-y-0.5">
        {availableDirs.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-1">暂无可用目录</p>
        ) : (
          availableDirs.map((dir) => (
            <button
              key={dir}
              onClick={() => setCustomValue(dir)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent transition-colors ${
                customValue === dir ? 'text-foreground font-medium' : 'text-foreground'
              }`}
            >
              {customValue === dir && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
              <span className="truncate">{dir}</span>
            </button>
          ))
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-border">
        <input
          type="text"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-2.5 py-1.5 text-xs border border-border bg-card text-foreground placeholder-muted-foreground rounded-sm focus:outline-none focus:border-primary mb-2 transition-colors"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleConfirm();
          }}
          disabled={!customValue.trim() || disabled || isLoading}
          className="w-full px-2.5 py-1.5 text-xs text-white bg-foreground rounded-sm hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? '处理中...' : confirmLabel}
        </button>
      </div>
      <button
        onClick={onCancel}
        className="w-full mt-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded-sm transition-colors"
      >
        取消
      </button>
    </div>
  );
}
