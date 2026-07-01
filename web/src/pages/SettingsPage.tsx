import { useState } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { Plus, Trash2, FileText } from 'lucide-react';

export default function SettingsPage() {
  const { config, addPath, removePath } = useCollections();
  const [newPath, setNewPath] = useState('');

  const handleAddPath = () => {
    if (newPath.trim()) {
      addPath(newPath.trim());
      setNewPath('');
    }
  };

  const handleRemovePath = (path: string) => {
    removePath(path);
  };

  return (
    <div className="flex-1 overflow-auto">
      {/* 顶部栏 */}
      <header className="px-8 py-5 flex-shrink-0">
        <h1 className="text-base font-medium text-[#1F1F1F]">设置</h1>
        <p className="text-sm text-[#6B7280] mt-1">配置文章内容路径</p>
      </header>

      <div className="px-8">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-medium mb-2">
            <FileText className="w-3 h-3" />
            已添加的路径 ({config.paths.length} 个)
          </div>

          <div className="space-y-px">
            {config.paths.map((path) => (
              <div key={path} className="flex items-center justify-between h-9 px-2 rounded-sm hover:bg-[#F9FAFA] transition-colors border-b border-[#F2F2F2] last:border-b-0 group">
                <code className="text-xs text-[#1F1F1F] font-mono">
                  {path.endsWith('/*.md') ? path : `${path.replace(/\/$/, '')}/*.md`}
                </code>
                {config.paths.length > 1 && (
                  <button
                    onClick={() => handleRemovePath(path)}
                    className="text-[#6B7280] hover:text-[#EF4444] opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-3">
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddPath();
                }
              }}
              className="flex-1 px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
              placeholder="添加新路径，如 content/articles"
            />
            <button
              onClick={handleAddPath}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              添加路径
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
