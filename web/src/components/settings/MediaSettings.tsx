import { useState, useCallback, useEffect, useRef } from 'react';
import { useCollections } from '../../contexts/CollectionsContext';
import { useRepo } from '../../contexts/RepoContext';
import { createBranch } from '../../lib/api';
import { DEFAULT_MEDIA_PATH, DEFAULT_BRANCH_NAME } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import {
  getMediaS3Config, saveMediaS3Config, testMediaS3Config,
  type MediaS3ConfigPublic,
} from '../../lib/mediaS3Api';
import {
  Image, Globe, Sliders, FileSignature,
  AlertTriangle, GitBranch, FolderOpen, Loader2, Cloud
} from 'lucide-react';
import type { CdnProvider, DuplicateStrategy, MediaSourceType, UploadMode } from '../../../../shared/types';

// 静态配置数组（模块级，避免每次渲染重建）
const MEDIA_SOURCE_TYPES: { value: MediaSourceType; label: string; desc: string; icon: typeof Image }[] = [
  { value: 'standalone', label: '独立图床仓库', desc: '图片上传到单独的 GitHub 仓库，与博客内容完全隔离', icon: Image },
  { value: 'repo-dir', label: '博客仓库子目录', desc: '图片存入当前博客仓库的指定目录，无需额外建仓', icon: FolderOpen },
  { value: 'image-branch', label: '博客仓库独立分支', desc: '在博客仓库创建独立分支存放图片，分支级隔离', icon: GitBranch },
  { value: 's3', label: 'S3 兼容图床', desc: '直接上传到 S3/R2/OSS 等对象存储，不经 GitHub（凭据加密存于服务端）', icon: Cloud }
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

const UPLOAD_MODES: { value: UploadMode; label: string; desc: string }[] = [
  { value: 'compress', label: '压缩', desc: '图片重编码为 WebP，体积小、加载快；GIF / SVG 自动按原图' },
  { value: 'original', label: '原图', desc: '保留原始格式与画质（含 EXIF），体积更大' },
];

/** S3 配置区输入框统一样式（模块级，避免 JSX 内联重复） */
const s3InputClass = 'w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground';

/**
 * S3 兼容图床配置区（P1-001 重写）：连接凭据经 /api/media/s3/config 保存到
 * Worker 侧加密存储，secret 留空沿用、AK 打码回显；publicBaseUrl 是唯一
 * 仍存 localStorage 的字段（外链模板，非敏感），走 mediaConfig.s3。
 */
function MediaS3Settings() {
  const { mediaConfig, updateMediaConfig } = useCollections();
  const { addToast } = useToast();
  const [remote, setRemote] = useState<MediaS3ConfigPublic | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({ endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '', prefix: '' });
  const [publicBaseUrl, setPublicBaseUrl] = useState(mediaConfig.s3?.publicBaseUrl ?? '');
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getMediaS3Config()
      .then((cfg) => {
        if (cancelled) return;
        setRemote(cfg);
        if (cfg && !dirtyRef.current) {
          setForm({ endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, accessKeyId: '', secretAccessKey: '', prefix: cfg.prefix });
        }
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveMediaS3Config({
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || 'auto',
        bucket: form.bucket.trim(),
        accessKeyId: form.accessKeyId.trim(),
        // secret 留空 = 沿用已存密钥（与缓冲层同语义）
        secretAccessKey: form.secretAccessKey,
        prefix: form.prefix.trim(),
      });
      setRemote(saved);
      setForm((f) => ({ ...f, accessKeyId: '', secretAccessKey: '' }));
      addToast({ message: '媒体图床配置已保存（凭据加密存于服务端）', type: 'success' });
    } catch (err) {
      addToast({ message: `保存失败：${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await testMediaS3Config({
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || 'auto',
        bucket: form.bucket.trim(),
        accessKeyId: form.accessKeyId.trim(),
        secretAccessKey: form.secretAccessKey,
        prefix: form.prefix.trim(),
      });
      addToast({ message: 'S3 连接成功', type: 'success' });
    } catch (err) {
      addToast({ message: `连接失败：${(err as Error).message}`, type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
        <Cloud className="w-3 h-3" />
        S3 兼容图床
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        支持 AWS S3 / Cloudflare R2 / 阿里 OSS / MinIO 等兼容存储。
        凭据经 HTTPS 提交后加密保存在服务端，浏览器不再明文持有；上传与删除经服务端代理执行。
      </p>
      {!loaded ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> 读取图床配置……
        </p>
      ) : (
        <div className="space-y-2">
          {remote && (
            <p className="text-[11px] text-muted-foreground">
              已配置：{remote.endpoint} / {remote.bucket}（AK {remote.accessKeyIdMasked}）。留空 Secret 表示沿用已存密钥。
            </p>
          )}
          <div>
            <label htmlFor="s3-endpoint" className="block text-[11px] text-muted-foreground mb-1">端点 Endpoint</label>
            <input
              id="s3-endpoint"
              type="text"
              value={form.endpoint}
              onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, endpoint: e.target.value })); }}
              placeholder="https://s3.example.com 或 R2 端点"
              className={s3InputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="s3-bucket" className="block text-[11px] text-muted-foreground mb-1">桶名 Bucket</label>
              <input
                id="s3-bucket"
                type="text"
                value={form.bucket}
                onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, bucket: e.target.value })); }}
                className={s3InputClass}
              />
            </div>
            <div>
              <label htmlFor="s3-region" className="block text-[11px] text-muted-foreground mb-1">区域 Region（可空 = auto）</label>
              <input
                id="s3-region"
                type="text"
                value={form.region}
                onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, region: e.target.value })); }}
                placeholder="auto"
                className={s3InputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="s3-ak" className="block text-[11px] text-muted-foreground mb-1">AccessKeyId{remote ? '（留空沿用）' : ''}</label>
              <input
                id="s3-ak"
                type="text"
                value={form.accessKeyId}
                onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, accessKeyId: e.target.value })); }}
                className={s3InputClass}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="s3-sk" className="block text-[11px] text-muted-foreground mb-1">SecretAccessKey{remote ? '（留空沿用）' : ''}</label>
              <input
                id="s3-sk"
                type="password"
                value={form.secretAccessKey}
                onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, secretAccessKey: e.target.value })); }}
                className={s3InputClass}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <label htmlFor="s3-prefix" className="block text-[11px] text-muted-foreground mb-1">目录前缀（可空 = 桶根）</label>
            <input
              id="s3-prefix"
              type="text"
              value={form.prefix}
              onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, prefix: e.target.value })); }}
              placeholder="images/2026"
              className={s3InputClass}
            />
          </div>
          <div>
            <label htmlFor="s3-cdn" className="block text-[11px] text-muted-foreground mb-1">公网访问基址（含 {'{path}'}；用于复制外链）</label>
            <input
              id="s3-cdn"
              type="text"
              value={publicBaseUrl}
              onChange={(e) => {
                dirtyRef.current = true;
                setPublicBaseUrl(e.target.value.trim());
                // 外链模板非敏感，仍存 mediaConfig（随配置同步；repoConfigSync 已剥离凭据）
                updateMediaConfig({ s3: { publicBaseUrl: e.target.value.trim() } });
              }}
              placeholder="https://cdn.example.com/{path}"
              className={s3InputClass}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !form.endpoint || !form.bucket}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-sm hover:bg-accent disabled:opacity-40 transition-colors"
            >
              {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              测试连接
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !form.endpoint || !form.bucket}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              保存配置
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const PLACEHOLDER_DOCS = [
  { token: '{{date:YYYY}}', desc: '年份，4 位数' },
  { token: '{{date:MM}}', desc: '月份，2 位数' },
  { token: '{{date:DD}}', desc: '日期，2 位数' },
  { token: '{{date:HH}}', desc: '小时，2 位数' },
  { token: '{{date:mm}}', desc: '分钟，2 位数' },
  { token: '{{date:SS}}', desc: '秒，2 位数' },
  { token: '{{filename}}', desc: '原始文件名（无扩展名）' },
  { token: '{{random:N}}', desc: 'N 位随机字符串，如 {{random:8}}' },
];

export function MediaSettings() {
  const { mediaConfig, updateMediaConfig } = useCollections();
  const { selectedRepo } = useRepo();
  const { addToast } = useToast();
  const [initializing, setInitializing] = useState(false);

  const handleInitBranch = async () => {
    if (!selectedRepo) {
      addToast({ message: '请先在侧边栏选择博客仓库', type: 'warning' });
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
        addToast({ message: msg || `分支 ${branchName} 初始化失败`, type: 'error' });
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
          <p className="text-xs text-muted-foreground mb-3">图片将上传到此 GitHub 仓库，请确保 Token 拥有该仓库的写入权限</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={mediaConfig.imageOwner}
              onChange={(e) => updateMediaConfig({ imageOwner: e.target.value.trim() })}
              className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-muted text-foreground placeholder-muted-foreground"
              placeholder="仓库所有者"
            />
            <span className="flex items-center text-muted-foreground">/</span>
            <input
              type="text"
              value={mediaConfig.imageRepo}
              onChange={(e) => updateMediaConfig({ imageRepo: e.target.value.trim() })}
              className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-muted text-foreground placeholder-muted-foreground"
              placeholder="仓库名，如 blog-images"
            />
            <span className="flex items-center text-muted-foreground">@</span>
            <input
              type="text"
              value={mediaConfig.imageBranch}
              onChange={(e) => updateMediaConfig({ imageBranch: e.target.value.trim() || 'main' })}
              className="w-24 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-muted text-foreground placeholder-muted-foreground"
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
            <p className="text-xs text-warning mb-3">请先在侧边栏选择博客仓库</p>
          )}
          <input
            type="text"
            value={mediaConfig.mediaPath}
            onChange={(e) => updateMediaConfig({ mediaPath: e.target.value.trim() || DEFAULT_MEDIA_PATH })}
            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
            placeholder={DEFAULT_MEDIA_PATH}
          />
          <p className="text-xs text-muted-foreground mt-1">默认为 {DEFAULT_MEDIA_PATH}；若为 Hugo 博客，可填 static/images</p>
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
            <p className="text-xs text-warning mb-3">请先在侧边栏选择博客仓库</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={mediaConfig.imageBranchName}
              onChange={(e) => updateMediaConfig({ imageBranchName: e.target.value.trim() || DEFAULT_BRANCH_NAME })}
              className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
              placeholder={DEFAULT_BRANCH_NAME}
            />
            <button
              type="button"
              onClick={handleInitBranch}
              disabled={initializing || !selectedRepo}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {initializing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
              {initializing ? '初始化中……' : '初始化分支'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">默认分支名 {DEFAULT_BRANCH_NAME}，可自定义</p>
        </section>
      )}

      {mediaConfig.sourceType === 's3' && (
        <MediaS3Settings />
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
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-muted text-foreground placeholder-muted-foreground mt-1"
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
          默认上传方式
        </div>
        <div className="space-y-2">
          {UPLOAD_MODES.map((item) => (
            <label key={item.value} htmlFor={`upload-mode-${item.value}`} className="flex items-start gap-2 cursor-pointer group">
              <input
                id={`upload-mode-${item.value}`}
                type="radio"
                name="uploadMode"
                value={item.value}
                checked={mediaConfig.uploadMode === item.value}
                onChange={() => updateMediaConfig({ uploadMode: item.value })}
                className="mt-0.5 accent-foreground"
              />
              <div>
                <div className="text-xs text-foreground font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          媒体库上传区默认选中该项，可在上传时临时切换（不写回此配置）。视频恒为原样上传。
        </p>
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
        <p className="text-xs text-muted-foreground mt-1">WebP 输出质量，值越高画质越好，文件也越大</p>
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
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
          placeholder="{{date:YYYY}}{{date:MM}}{{date:DD}}-{{filename}}-{{random:8}}"
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
