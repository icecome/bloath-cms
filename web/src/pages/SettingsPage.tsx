import { useState } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { Plus, Trash2, FileText, Image } from 'lucide-react';
import { MediaSettings } from '../components/settings/MediaSettings';

export default function SettingsPage() {
  const { config, addPath, removePath } = useCollections();
  const [newPath, setNewPath] = useState('');
  const [activeTab, setActiveTab] = useState<'content' | 'media'>('content');

  const handleAddPath = () => {
    if (newPath.trim()) {
      addPath(newPath.trim());
      setNewPath('');
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      {/* 顶部栏 */}
      <header className="px-8 py-5 flex-shrink-0">
        <h1 className="text-base font-medium text-foreground">设置</h1>
        <p className="text-sm text-muted-foreground mt-1">配置内容与媒体库</p>
      </header>

      {/* Tab 切换 */}
      <div className="px-8 pb-4 flex gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('content')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors ${
            activeTab === 'content'
              ? 'bg-foreground text-white'
              : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          内容路径
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('media')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors ${
            activeTab === 'media'
              ? 'bg-foreground text-white'
              : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          <Image className="w-3.5 h-3.5" />
          媒体库
        </button>
      </div>

      <div className="px-8">
        {activeTab === 'content' && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
              <FileText className="w-3 h-3" />
              已添加的路径 ({config.paths.length} 个)
            </div>

            <div className="space-y-px">
              {config.paths.map((path) => (
                <div key={path} className="flex items-center justify-between h-9 px-2 rounded-sm hover:bg-accent transition-colors border-b border-border last:border-b-0 group">
                  <code className="text-xs text-foreground font-mono">
                    {path.endsWith('/*.md') ? path : `${path.replace(/\/$/, '')}/*.md`}
                  </code>
                  <button
                    type="button"
                    onClick={() => removePath(path)}
                    disabled={config.paths.length <= 1}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0 disabled:cursor-not-allowed"
                    aria-label="删除路径"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
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
                className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground placeholder-muted-foreground"
                placeholder="添加新路径，如 content/articles"
              />
              <button
                type="button"
                onClick={handleAddPath}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加路径
              </button>
            </div>
          </div>
        )}

        {activeTab === 'media' && <MediaSettings />}
      </div>
    </div>
  );
}
