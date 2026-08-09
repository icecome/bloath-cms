import { useState, useCallback } from 'react';
import { useCollections } from '../../contexts/CollectionsContext';
import { useRepo } from '../../contexts/RepoContext';
import { createBranch } from '../../lib/api';
import { DEFAULT_MEDIA_PATH, DEFAULT_BRANCH_NAME } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import {
  Image, Globe, Sliders, FileSignature,
  AlertTriangle, GitBranch, FolderOpen, Loader2
} from 'lucide-react';
import type { CdnProvider, DuplicateStrategy, MediaSourceType } from '../../../../shared/types';

// 静态配置数组（模块级，避免每次渲染重建）
const MEDIA_SOURCE_TYPES: { value: MediaSourceType; label: string; desc: string; icon: typeof Image }[] = [
  { value: 'standalone', label: '独立图床仓库', desc: '图片上传到单独的 GitHub 仓库，与博客内容完全隔离', icon: Image },
  { value: 'repo-dir', label: '博客仓库子目录', desc: '图片存入当前博客仓库的指定目录，无需额外建仓', icon: FolderOpen },
  { value: 'image-branch', label: '博客仓库独立分支', desc: '在博客仓库创建独立分支存放图片，分支级隔离', icon: GitBranch }
];

const CDN_PROVIDERS: { value: CdnProvider; label: string; template: string }[] = [
  { value: 'jsdmirror', label: 'jsMirror', template: 'https://cdn.jsdmirror.cn/gh/{owner}/{repo}@{branch}/{path}' },
  { value: 'github_raw', label: 'GitHub Raw', template: 'https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}' },
  { value: 'custom', label: '自定义', template: '' },
];

const DUPLICATE_STRATEGIES: { value: DuplicateStrategy; label: string; desc: string }[] = [
  { value: 'skip', label: '跳过', desc: '检测到同名文件时跳过上传' },
  { value: 'overwrite', label: '覆盖', desc: '直接覆盖同名文件' },
];

const PLACEHOLDER_DOCS = [
  { token: '{Y}', desc: '年份，4位数' },
  { token: '{m}', desc: '月份，2位数' },
  { token: '{d}', desc: '日期，2位数' },
  { token: '{h}', desc: '小时，2位数' },
  { token: '{i}', desc: '分钟，2位数' },
  { token: '{s}', desc: '秒，2位数' },
  { token: '{filename}', desc: '原始文件名（无扩展名）' },
  { token: '{str-n}', desc: 'n位随机字符串，如 {str-4}' },
];

export function MediaSettings() {
  const { mediaConfig, updateMediaConfig } = useCollections();
  const { selectedRepo } = useRepo();
  const { addToast } = useToast();
  const [initializing, setInitializing] = useState(false);

  const handleInitBranch = async () => {
    if (!selectedRepo) {
      addToast({ message: '请先在仪表盘选择博客仓库', type: 'warning' });
      return;
    }
    const branchName = mediaConfig.imageBranchName || DEFAULT_BRANCH_NAME;
    setInitializing(true);
    try {
      await createBranch({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branchName,
        sourceBranch: selectedRepo.branch || 'main'
      });
      addToast({ message: `分支 ${branchName} 已就绪`, type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('已存在')) {
        addToast({ message: `分支 ${branchName} 已存在，可直接使用`, type: 'success' });
      } else {
        addToast({ message: msg || '初始化失败', type: 'error' });
      }
    } finally {
      setInitializing(false);
    }
  };

  const resolveCdnPreview = useCallback(() => {
    const { cdnProvider, customCdnTemplate, imageOwner, imageRepo, imageBranch } = mediaConfig;
    if (cdnProvider === 'custom') {
      return customCdnTemplate || '请配置自定义 CDN 模板';
    }
    const provider = CDN_PROVIDERS.find(p => p.value === cdnProvider);
    if (!provider || !imageOwner || !imageRepo) return '请先配置图床仓库';
    return provider.template
      .replace('{owner}', imageOwner)
      .replace('{repo}', imageRepo)
      .replace('{branch}', imageBranch || 'main')
      .replace('{path}', 'example.webp');
  }, [mediaConfig]);

  return (
    <div className="space-y-6 max-w-xl">
      <section>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
          <Image className="w-3 h-3" />
          媒体源类型
        </div>
        <div className="space-y-2">
          {MEDIA_SOURCE_TYPES.map((src) => {
            const Icon = src.icon;
            return (
              <label key={src.value} htmlFor={`src-${src.value}`} className="flex items-start gap-2 cursor-pointer group">
                <input
                  id={`src-${src.value}`}
                  type="radio"
                  name="mediaSourceType"
                  value={src.value}
                  checked={mediaConfig.sourceType === src.value}
                  onChange={() => updateMediaConfig({ sourceType: src.value })}
                  className="mt-0.5 accent-foreground"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-foreground font-medium">{src.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{src.desc}</div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {mediaConfig.sourceType === 'standalone' && (
        <section>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
            <Image className="w-3 h-3" />
            图床仓库
          </div>
          <p className="text-xs text-muted-foreground mb-3">图片将上传到此 GitHub 仓库，请确保 Token 有该仓库的写入权限</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={mediaConfig.imageOwner}
              onChange={(e) => updateMediaConfig({ imageOwner: e.target.value.trim() })}
              className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground placeholder-muted-foreground"
              placeholder="仓库所有者"
            />
            <span className="flex items-center text-muted-foreground">/</span>
            <input
              type="text"
              value={mediaConfig.imageRepo}
              onChange={(e) => updateMediaConfig({ imageRepo: e.target.value.trim() })}
              className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground placeholder-muted-foreground"
              placeholder="仓库名，如 blog-images"
            />
            <span className="flex items-center text-muted-foreground">@</span>
            <input
              type="text"
              value={mediaConfig.imageBranch}
              onChange={(e) => updateMediaConfig({ imageBranch: e.target.value.trim() || 'main' })}
              className="w-24 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground placeholder-muted-foreground"
              placeholder="分支"
            />
          </div>
        </section>
      )}

      {mediaConfig.sourceType === 'repo-dir' && (
        <section>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
            <FolderOpen className="w-3 h-3" />
            图片存放目录
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            图片将存入当前选中博客仓库的指定子目录
          </p>
          {selectedRepo ? (
            <p className="text-xs text-muted-foreground mb-3">
              当前仓库：<code className="text-foreground font-mono">{selectedRepo.owner}/{selectedRepo.repo}</code>
            </p>
          ) : (
            <p className="text-xs text-amber-600 mb-3">请先在仪表盘选择博客仓库</p>
          )}
          <input
            type="text"
            value={mediaConfig.mediaPath}
            onChange={(e) => updateMediaConfig({ mediaPath: e.target.value.trim() || DEFAULT_MEDIA_PATH })}
            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
            placeholder={DEFAULT_MEDIA_PATH}
          />
          <p className="text-xs text-muted-foreground mt-1">默认 {DEFAULT_MEDIA_PATH}，Hugo 博客可填 static/images</p>
        </section>
      )}

      {mediaConfig.sourceType === 'image-branch' && (
        <section>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
            <GitBranch className="w-3 h-3" />
            独立分支
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            在博客仓库创建独立分支存放图片，与内容分支隔离
          </p>
          {selectedRepo ? (
            <p className="text-xs text-muted-foreground mb-3">
              当前仓库：<code className="text-foreground font-mono">{selectedRepo.owner}/{selectedRepo.repo}</code>
            </p>
          ) : (
            <p className="text-xs text-amber-600 mb-3">请先在仪表盘选择博客仓库</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={mediaConfig.imageBranchName}
              onChange={(e) => updateMediaConfig({ imageBranchName: e.target.value.trim() || DEFAULT_BRANCH_NAME })}
              className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
              placeholder={DEFAULT_BRANCH_NAME}
            />
            <button
              type="button"
              onClick={handleInitBranch}
              disabled={initializing || !selectedRepo}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {initializing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
              {initializing ? '初始化中...' : '初始化分支'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">默认分支名 {DEFAULT_BRANCH_NAME}，可自定义</p>
        </section>
      )}

      <section>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
          <Globe className="w-3 h-3" />
          CDN 域名
        </div>
        <div className="space-y-2">
          {CDN_PROVIDERS.map((provider) => (
            <label key={provider.value} htmlFor={`cdn-${provider.value}`} className="flex items-start gap-2 cursor-pointer group">
              <input
                id={`cdn-${provider.value}`}
                type="radio"
                name="cdnProvider"
                value={provider.value}
                checked={mediaConfig.cdnProvider === provider.value}
                onChange={() => updateMediaConfig({ cdnProvider: provider.value })}
                className="mt-0.5 accent-foreground"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground font-medium">{provider.label}</div>
                {provider.template && (
                  <code className="text-xs text-muted-foreground font-mono break-all">{provider.template}</code>
                )}
              </div>
            </label>
          ))}
          {mediaConfig.cdnProvider === 'custom' && (
            <input
              type="text"
              value={mediaConfig.customCdnTemplate}
              onChange={(e) => updateMediaConfig({ customCdnTemplate: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground placeholder-muted-foreground mt-1"
              placeholder="模板变量：{owner} {repo} {branch} {path}"
            />
          )}
        </div>
        <div className="mt-2 px-2.5 py-1.5 bg-accent rounded-sm">
          <span className="text-xs text-muted-foreground">预览：</span>
          <code className="text-xs text-foreground font-mono break-all">{resolveCdnPreview()}</code>
        </div>
      </section>

      <section>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
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
            className="flex-1 accent-foreground"
          />
          <span className="text-xs text-foreground font-mono w-8 text-right">{mediaConfig.quality}%</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">WebP 输出质量，值越高画质越好但文件越大</p>
      </section>

      <section>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
          <FileSignature className="w-3 h-3" />
          重命名模板
        </div>
        <input
          type="text"
          value={mediaConfig.renameTemplate}
          onChange={(e) => updateMediaConfig({ renameTemplate: e.target.value })}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
          placeholder="{Y}{m}{d}{h}{i}{s}{str-4}"
        />
        <div className="mt-2 grid grid-cols-2 gap-1">
          {PLACEHOLDER_DOCS.map((item) => (
            <div key={item.token} className="flex items-center gap-1.5 text-xs">
              <code className="px-1 py-0.5 bg-accent rounded-sm text-foreground font-mono text-xs">{item.token}</code>
              <span className="text-muted-foreground">{item.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
          <AlertTriangle className="w-3 h-3" />
          同名文件策略
        </div>
        <div className="space-y-2">
          {DUPLICATE_STRATEGIES.map((strategy) => (
            <label key={strategy.value} htmlFor={`dup-${strategy.value}`} className="flex items-start gap-2 cursor-pointer group">
              <input
                id={`dup-${strategy.value}`}
                type="radio"
                name="duplicateStrategy"
                value={strategy.value}
                checked={mediaConfig.duplicateStrategy === strategy.value}
                onChange={() => updateMediaConfig({ duplicateStrategy: strategy.value })}
                className="mt-0.5 accent-foreground"
              />
              <div>
                <div className="text-xs text-foreground font-medium">{strategy.label}</div>
                <div className="text-xs text-muted-foreground">{strategy.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
