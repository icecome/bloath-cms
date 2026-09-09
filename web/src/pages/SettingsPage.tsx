import { useState } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { useRepo } from '../contexts/RepoContext';
import { useAuth } from '../hooks/useAuth';
import { Plus, Trash2, FileText, Image, Globe, UploadCloud } from 'lucide-react';
import { MediaSettings } from '../components/settings/MediaSettings';
import { SiteSettings } from '../components/settings/SiteSettings';
import { pushRepoConfig } from '../lib/repoConfigSync';
import { useToast } from '../contexts/ToastContext';

// 配置同步到仓库（手动推送：切换仓库时自动拉取，仓库为准）
function RepoSyncSection() {
  const { selectedRepo } = useRepo();
  const { user } = useAuth();
  const { config, mediaConfig } = useCollections();
  const { addToast } = useToast();
  const [pushing, setPushing] = useState(false);

  const handlePush = async () => {
    if (!selectedRepo || !user) return;
    setPushing(true);
    try {
      await pushRepoConfig(
        selectedRepo.owner,
        selectedRepo.repo,
        selectedRepo.branch,
        {
          version: 1,
          collections: {
            paths: config.paths,
            label: config.label,
            draftPath: config.draftPath,
            trashPath: config.trashPath
          },
          media: mediaConfig
        },
        user.login
      );
      addToast({ message: '配置已同步到仓库 .bloath/config.json', type: 'success' });
    } catch (err) {
      addToast({ message: `同步失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setPushing(false);
    }
  };

  if (!selectedRepo) {
    return <p className="text-xs text-muted-foreground pt-2">选择仓库后可将配置同步到仓库，实现多设备共享。</p>;
  }

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
        <UploadCloud className="w-3 h-3" />
        配置仓库化
      </h3>
      <p className="text-xs text-muted-foreground">
        切换仓库时自动以仓库配置为准；本地修改内容路径/媒体配置后，点此推送到仓库（其他设备生效）。
      </p>
      <button
        type="button"
        onClick={handlePush}
        disabled={pushing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors"
      >
        <UploadCloud className="w-3.5 h-3.5" />
        {pushing ? '同步中...' : '同步配置到仓库'}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { config, addPath, removePath } = useCollections();
  const [newPath, setNewPath] = useState('');
  const [activeTab, setActiveTab] = useState<'content' | 'media' | 'site'>('content');

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
        <button
          type="button"
          onClick={() => setActiveTab('site')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors ${
            activeTab === 'site'
              ? 'bg-foreground text-white'
              : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          站点与部署
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

            <RepoSyncSection />
          </div>
        )}

        {activeTab === 'media' && <MediaSettings />}

        {activeTab === 'site' && <SiteSettings />}
      </div>
    </div>
  );
}
