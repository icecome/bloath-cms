import { useState } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { Plus, Trash2, FileText, Image, Globe, Sliders, FileSignature, AlertTriangle } from 'lucide-react';
import type { CdnProvider, DuplicateStrategy } from '../../../shared/types';

export default function SettingsPage() {
  const { config, addPath, removePath, mediaConfig, updateMediaConfig } = useCollections();
  const [newPath, setNewPath] = useState('');
  const [activeTab, setActiveTab] = useState<'content' | 'media'>('content');

  const handleAddPath = () => {
    if (newPath.trim()) {
      addPath(newPath.trim());
      setNewPath('');
    }
  };

  const handleRemovePath = (path: string) => {
    removePath(path);
  };

  const cdnProviders: { value: CdnProvider; label: string; template: string }[] = [
    { value: 'jsdmirror', label: 'jsMirror', template: 'https://cdn.jsdmirror.cn/gh/{owner}/{repo}@main/{path}' },
    { value: 'github_raw', label: 'GitHub Raw', template: 'https://raw.githubusercontent.com/{owner}/{repo}/main/{path}' },
    { value: 'custom', label: '自定义', template: '' },
  ];

  const duplicateStrategies: { value: DuplicateStrategy; label: string; desc: string }[] = [
    { value: 'skip', label: '跳过', desc: '检测到同名文件时跳过上传' },
    { value: 'overwrite', label: '覆盖', desc: '直接覆盖同名文件' },
  ];

  const placeholderDocs = [
    { token: '{Y}', desc: '年份，4位数' },
    { token: '{m}', desc: '月份，2位数' },
    { token: '{d}', desc: '日期，2位数' },
    { token: '{h}', desc: '小时，2位数' },
    { token: '{i}', desc: '分钟，2位数' },
    { token: '{s}', desc: '秒，2位数' },
    { token: '{filename}', desc: '原始文件名（无扩展名）' },
    { token: '{str-n}', desc: 'n位随机字符串，如 {str-4}' },
  ];

  const resolveCdnPreview = () => {
    const { cdnProvider, customCdnTemplate, imageOwner, imageRepo } = mediaConfig;
    if (cdnProvider === 'custom') {
      return customCdnTemplate || '请配置自定义 CDN 模板';
    }
    const provider = cdnProviders.find(p => p.value === cdnProvider);
    if (!provider || !imageOwner || !imageRepo) return '请先配置图床仓库';
    return provider.template.replace('{owner}', imageOwner).replace('{repo}', imageRepo).replace('{path}', 'example.webp');
  };

  return (
    <div className="flex-1 overflow-auto">
      {/* 顶部栏 */}
      <header className="px-8 py-5 flex-shrink-0">
        <h1 className="text-base font-medium text-[#1F1F1F]">设置</h1>
        <p className="text-sm text-[#6B7280] mt-1">配置内容与媒体库</p>
      </header>

      {/* Tab 切换 */}
      <div className="px-8 pb-4 flex gap-1">
        <button
          onClick={() => setActiveTab('content')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors ${
            activeTab === 'content'
              ? 'bg-[#1F1F1F] text-white'
              : 'text-[#6B7280] hover:bg-[#F3F4F6]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          内容路径
        </button>
        <button
          onClick={() => setActiveTab('media')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors ${
            activeTab === 'media'
              ? 'bg-[#1F1F1F] text-white'
              : 'text-[#6B7280] hover:bg-[#F3F4F6]'
          }`}
        >
          <Image className="w-3.5 h-3.5" />
          媒体库
        </button>
      </div>

      <div className="px-8">
        {activeTab === 'content' && (
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
        )}

        {activeTab === 'media' && (
          <div className="space-y-6 max-w-xl">
            {/* 图床仓库 */}
            <section>
              <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-medium mb-2">
                <Image className="w-3 h-3" />
                图床仓库
              </div>
              <p className="text-xs text-[#9CA3AF] mb-3">图片将上传到此 GitHub 仓库，请确保 Token 有该仓库的写入权限</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mediaConfig.imageOwner}
                  onChange={(e) => updateMediaConfig({ imageOwner: e.target.value.trim() })}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                  placeholder="仓库所有者"
                />
                <span className="flex items-center text-[#9CA3AF]">/</span>
                <input
                  type="text"
                  value={mediaConfig.imageRepo}
                  onChange={(e) => updateMediaConfig({ imageRepo: e.target.value.trim() })}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                  placeholder="仓库名，如 blog-images"
                />
                <span className="flex items-center text-[#9CA3AF]">@</span>
                <input
                  type="text"
                  value={mediaConfig.imageBranch}
                  onChange={(e) => updateMediaConfig({ imageBranch: e.target.value.trim() || 'main' })}
                  className="w-24 px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF]"
                  placeholder="分支"
                />
              </div>
            </section>

            {/* CDN 域名 */}
            <section>
              <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-medium mb-2">
                <Globe className="w-3 h-3" />
                CDN 域名
              </div>
              <div className="space-y-2">
                {cdnProviders.map((provider) => (
                  <label key={provider.value} htmlFor={`cdn-${provider.value}`} className="flex items-start gap-2 cursor-pointer group">
                    <input
                      id={`cdn-${provider.value}`}
                      type="radio"
                      name="cdnProvider"
                      value={provider.value}
                      checked={mediaConfig.cdnProvider === provider.value}
                      onChange={() => updateMediaConfig({ cdnProvider: provider.value })}
                      className="mt-0.5 accent-[#1F1F1F]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#1F1F1F] font-medium">{provider.label}</div>
                      {provider.template && (
                        <code className="text-xs text-[#9CA3AF] font-mono break-all">{provider.template}</code>
                      )}
                    </div>
                  </label>
                ))}
                {mediaConfig.cdnProvider === 'custom' && (
                  <input
                    type="text"
                    value={mediaConfig.customCdnTemplate}
                    onChange={(e) => updateMediaConfig({ customCdnTemplate: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] placeholder-[#9CA3AF] mt-1"
                    placeholder="模板变量：{owner} {repo} {path}"
                  />
                )}
              </div>
              <div className="mt-2 px-2.5 py-1.5 bg-[#F9FAFA] rounded-sm">
                <span className="text-xs text-[#6B7280]">预览：</span>
                <code className="text-xs text-[#1F1F1F] font-mono break-all">{resolveCdnPreview()}</code>
              </div>
            </section>

            {/* 压缩质量 */}
            <section>
              <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-medium mb-2">
                <Sliders className="w-3 h-3" />
                压缩质量
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={mediaConfig.quality}
                  onChange={(e) => updateMediaConfig({ quality: Math.min(100, Math.max(10, parseInt(e.target.value, 10))) })}
                  className="flex-1 accent-[#1F1F1F]"
                />
                <span className="text-xs text-[#1F1F1F] font-mono w-8 text-right">{mediaConfig.quality}%</span>
              </div>
              <p className="text-xs text-[#9CA3AF] mt-1">WebP 输出质量，值越高画质越好但文件越大</p>
            </section>

            {/* 重命名模板 */}
            <section>
              <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-medium mb-2">
                <FileSignature className="w-3 h-3" />
                重命名模板
              </div>
              <input
                type="text"
                value={mediaConfig.renameTemplate}
                onChange={(e) => updateMediaConfig({ renameTemplate: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs border border-[#E8E8E8] rounded-sm focus:outline-none focus:border-[#3B82F6] transition-colors bg-white text-[#1F1F1F] font-mono placeholder-[#9CA3AF]"
                placeholder="{Y}{m}{d}{h}{i}{s}{str-4}"
              />
              <div className="mt-2 grid grid-cols-2 gap-1">
                {placeholderDocs.map((item) => (
                  <div key={item.token} className="flex items-center gap-1.5 text-xs">
                    <code className="px-1 py-0.5 bg-[#F3F4F6] rounded-sm text-[#1F1F1F] font-mono text-xs">{item.token}</code>
                    <span className="text-[#9CA3AF]">{item.desc}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 同名策略 */}
            <section>
              <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-medium mb-2">
                <AlertTriangle className="w-3 h-3" />
                同名文件策略
              </div>
              <div className="space-y-2">
                {duplicateStrategies.map((strategy) => (
                  <label key={strategy.value} htmlFor={`dup-${strategy.value}`} className="flex items-start gap-2 cursor-pointer group">
                    <input
                      id={`dup-${strategy.value}`}
                      type="radio"
                      name="duplicateStrategy"
                      value={strategy.value}
                      checked={mediaConfig.duplicateStrategy === strategy.value}
                      onChange={() => updateMediaConfig({ duplicateStrategy: strategy.value })}
                      className="mt-0.5 accent-[#1F1F1F]"
                    />
                    <div>
                      <div className="text-xs text-[#1F1F1F] font-medium">{strategy.label}</div>
                      <div className="text-xs text-[#9CA3AF]">{strategy.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
