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
    <div className="absolute top-full left-0 mt-1 bg-white border border-[#E8E8E8] z-50 min-w-[250px] p-2 shadow-lg">
      <p className="text-xs text-[#6B7280] mb-2 px-1">
        {variant === 'publish' ? '发布到目标目录：' :
         variant === 'restore' ? '恢复到目标目录：' :
         '移动到：'}
      </p>
      <div className="space-y-0.5">
        {availableDirs.length === 0 ? (
          <p className="text-xs text-[#6B7280] px-2 py-1">暂无可用目录</p>
        ) : (
          availableDirs.map((dir) => (
            <button
              key={dir}
              onClick={() => setCustomValue(dir)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-[#F9FAFA] transition-colors ${
                customValue === dir ? 'text-[#1F1F1F] font-medium' : 'text-[#374151]'
              }`}
            >
              {customValue === dir && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
              <span className="truncate">{dir}</span>
            </button>
          ))
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-[#F2F2F2]">
        <input
          type="text"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] bg-white text-[#1F1F1F] placeholder-[#9CA3AF] rounded-sm focus:outline-none focus:border-[#3B82F6] mb-2 transition-colors"
        />
        <button
          onClick={handleConfirm}
          disabled={!customValue.trim() || disabled || isLoading}
          className="w-full px-2.5 py-1.5 text-xs text-white bg-[#1F1F1F] rounded-sm hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? '处理中...' : confirmLabel}
        </button>
      </div>
      <button
        onClick={onCancel}
        className="w-full mt-1 px-2.5 py-1.5 text-xs text-[#6B7280] hover:bg-[#F9FAFA] rounded-sm transition-colors"
      >
        取消
      </button>
    </div>
  );
}
