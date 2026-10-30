// 媒体库设置页：并行媒体仓库管理 + 上传/重命名/同名策略/压缩配置。
//
// 与旧版（单选 sourceType）的核心差异：
//   · 「媒体源类型」单选 → 「并行媒体仓库」列表：可添加多个不同/相同类型的后端，
//     每个后端独立配置定位参数（GitHub 三件套 / S3 外链基址）。
//   · 新增「默认后端媒体仓库」单选标记：上传未指定目标时回退到此；媒体库页初始也指向它。
//   · 旧 sourceType + 扁平字段（imageOwner/imageRepo/...）在加载时自动迁移为单个 backend
//     （见 configSchema 的 backendFromLegacy）；本组件**只读写 backends/defaultBackendId**，
//     不再写 sourceType 等迁移源字段——它们仅作为迁移兼容保留。
//
// S3 多桶：每个 S3 后端的凭据（endpoint/bucket/AK/SK）独立经 /api/media/s3/config?backendId=
// 加密保存于 Worker（分键 media_s3_config:<id>），浏览器仅持 publicBaseUrl。
import { useState, useCallback, useEffect, useRef } from 'react';
import { useCollections } from '../../contexts/CollectionsContext';
import { useRepo } from '../../contexts/RepoContext';
import { createBranch } from '../../lib/api';
import { DEFAULT_MEDIA_PATH, DEFAULT_BRANCH_NAME } from '../../lib/constants';
import { useToast } from '../../contexts/ToastContext';
import {
  getMediaS3Config, saveMediaS3Config, testMediaS3Config, deleteMediaS3Config,
  type MediaS3ConfigPublic,
} from '../../lib/mediaS3Api';
import {
  Image, Globe, Sliders, FileSignature, Plus, Trash2, Star,
  AlertTriangle, GitBranch, FolderOpen, Loader2, Cloud
} from 'lucide-react';
import type {
  CdnProvider, DuplicateStrategy, MediaBackend, MediaBackendKind, UploadMode,
} from '../../../../shared/types';

/** 后端类型元信息（模块级，避免每次渲染重建） */
const BACKEND_KINDS: { value: MediaBackendKind; label: string; desc: string; icon: typeof Image }[] = [
  { value: 'standalone', label: '独立图床仓库', desc: '图片上传到单独的 GitHub 仓库，与博客内容完全隔离', icon: Image },
  { value: 'repo-dir', label: '博客仓库子目录', desc: '图片存入当前博客仓库的指定目录，无需额外建仓', icon: FolderOpen },
  { value: 'image-branch', label: '博客仓库独立分支', desc: '在博客仓库创建独立分支存放图片，分支级隔离', icon: GitBranch },
  { value: 's3', label: 'S3 兼容图床', desc: '直接上传到 S3/R2/OSS 等对象存储，不经 GitHub（凭据加密存于服务端）', icon: Cloud },
];

const CDN_PROVIDERS: { value: CdnProvider; label: string; template: string }[] = [
  { value: 'jsdelivr', label: 'jsDelivr', template: 'https://testingcf.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}' },
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
const s3InputClass = 'w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground';

/** 生成新 backend id：短前缀 + 随机后缀，保证在白名单 [a-zA-Z0-9_-] 内且不与既有 id 碰撞 */
function newBackendId(kind: MediaBackendKind): string {
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 单个后端媒体仓库的编辑面板（可折叠/展开，每个后端独立配置）。
 *
 * S3 后端额外提供「凭据保存/测试」交互（MediaS3CredentialForm）：
 * 凭据经 backendId 分键加密存于 Worker，publicBaseUrl 仍存本地 mediaConfig。
 */
function BackendItem({
  backend,
  isDefault,
  onChange,
  onRemove,
  onSetDefault,
  disabled,
}: {
  backend: MediaBackend;
  isDefault: boolean;
  onChange: (patch: Partial<MediaBackend>) => void;
  onRemove: () => void;
  onSetDefault: () => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const kindMeta = BACKEND_KINDS.find((k) => k.value === backend.kind);
  const Icon = kindMeta?.icon ?? Image;

  return (
    <div className={`border rounded-sm ${isDefault ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          value={backend.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="flex-1 min-w-0 px-2 py-1 text-xs border border-border rounded-sm bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="显示名"
          aria-label="后端显示名"
        />
        {isDefault && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary-text font-medium whitespace-nowrap">
            默认
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-accent text-muted-foreground whitespace-nowrap">
          {kindMeta?.label ?? backend.kind}
        </span>
      </div>

      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-subtle">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={backend.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="accent-primary"
            aria-label="启用此后端"
          />
          启用
        </label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1 transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? '收起' : '配置'}
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary-text px-1.5 py-1 transition-colors"
          >
            <Star className="w-3 h-3" />
            设默认
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive px-1.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="删除此后端"
        >
          <Trash2 className="w-3 h-3" />
          删除
        </button>
      </div>

      {expanded && (
        <div className="px-3 py-3 border-t border-border space-y-3">
          {backend.kind === 's3' ? (
            <S3BackendForm backend={backend} onChange={onChange} />
          ) : backend.kind === 'repo-dir' ? (
            <RepoDirForm backend={backend} onChange={onChange} />
          ) : backend.kind === 'image-branch' ? (
            <ImageBranchForm backend={backend} onChange={onChange} />
          ) : (
            <StandaloneForm backend={backend} onChange={onChange} />
          )}
        </div>
      )}
    </div>
  );
}

/** standalone 后端：owner/repo/branch 三件套 */
function StandaloneForm({ backend, onChange }: { backend: MediaBackend; onChange: (p: Partial<MediaBackend>) => void }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">图片将上传到此 GitHub 仓库，请确保 Token 拥有该仓库的写入权限</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={backend.owner || ''}
          onChange={(e) => onChange({ owner: e.target.value.trim() })}
          className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground placeholder-muted-foreground"
          placeholder="仓库所有者"
        />
        <span className="flex items-center text-muted-foreground">/</span>
        <input
          type="text"
          value={backend.repo || ''}
          onChange={(e) => onChange({ repo: e.target.value.trim() })}
          className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground placeholder-muted-foreground"
          placeholder="仓库名，如 blog-images"
        />
        <span className="flex items-center text-muted-foreground">@</span>
        <input
          type="text"
          value={backend.branch || 'main'}
          onChange={(e) => onChange({ branch: e.target.value.trim() || 'main' })}
          className="w-24 px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground placeholder-muted-foreground"
          placeholder="分支"
        />
      </div>
    </>
  );
}

/** repo-dir 后端：当前博客仓库子目录 */
function RepoDirForm({ backend, onChange }: { backend: MediaBackend; onChange: (p: Partial<MediaBackend>) => void }) {
  const { selectedRepo } = useRepo();
  return (
    <>
      <p className="text-xs text-muted-foreground">图片将存入当前选中博客仓库的指定子目录</p>
      {selectedRepo ? (
        <p className="text-xs text-muted-foreground">
          当前仓库：<code className="text-foreground font-mono">{selectedRepo.owner}/{selectedRepo.repo}</code>
        </p>
      ) : (
        <p className="text-xs text-warning">请先在侧边栏选择博客仓库</p>
      )}
      <input
        type="text"
        value={backend.pathPrefix || DEFAULT_MEDIA_PATH}
        onChange={(e) => onChange({ pathPrefix: e.target.value.trim() || DEFAULT_MEDIA_PATH })}
        className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
        placeholder={DEFAULT_MEDIA_PATH}
      />
      <p className="text-xs text-muted-foreground">默认为 {DEFAULT_MEDIA_PATH}；若为 Hugo 博客，可填 static/images</p>
    </>
  );
}

/** image-branch 后端：博客仓库独立分支 */
function ImageBranchForm({ backend, onChange }: { backend: MediaBackend; onChange: (p: Partial<MediaBackend>) => void }) {
  const { selectedRepo } = useRepo();
  const { addToast } = useToast();
  const [initializing, setInitializing] = useState(false);
  const branchName = backend.branch || DEFAULT_BRANCH_NAME;

  const handleInitBranch = async () => {
    if (!selectedRepo) {
      addToast({ message: '请先在侧边栏选择博客仓库', type: 'warning' });
      return;
    }
    setInitializing(true);
    try {
      await createBranch({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branchName,
        sourceBranch: selectedRepo.branch || 'main',
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

  return (
    <>
      <p className="text-xs text-muted-foreground">在博客仓库创建独立分支存放图片，与内容分支隔离</p>
      {selectedRepo ? (
        <p className="text-xs text-muted-foreground">
          当前仓库：<code className="text-foreground font-mono">{selectedRepo.owner}/{selectedRepo.repo}</code>
        </p>
      ) : (
        <p className="text-xs text-warning">请先在侧边栏选择博客仓库</p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={branchName}
          onChange={(e) => onChange({ branch: e.target.value.trim() || DEFAULT_BRANCH_NAME })}
          className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
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
      <p className="text-xs text-muted-foreground">默认分支名 {DEFAULT_BRANCH_NAME}，可自定义</p>
    </>
  );
}

/**
 * S3 后端配置：连接凭据经 /api/media/s3/config?backendId= 保存到 Worker 侧加密存储，
 * secret 留空沿用、AK 打码回显；publicBaseUrl 是唯一仍存 localStorage 的字段（外链模板，
 * 非敏感），走 mediaConfig.backends 的 s3PublicBaseUrl。
 */
function S3BackendForm({ backend, onChange }: { backend: MediaBackend; onChange: (p: Partial<MediaBackend>) => void }) {
  const { addToast } = useToast();
  const [remote, setRemote] = useState<MediaS3ConfigPublic | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** 读取失败标记：区分「服务端确实没配」与「读取出错」，避免两者都表现为空白表单 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({ endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '', prefix: '' });
  const [publicBaseUrl, setPublicBaseUrl] = useState(backend.s3PublicBaseUrl ?? '');
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getMediaS3Config(backend.id)
      .then((cfg) => {
        if (cancelled) return;
        setRemote(cfg);
        if (cfg && !dirtyRef.current) {
          setForm({ endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, accessKeyId: '', secretAccessKey: '', prefix: cfg.prefix });
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // 读取失败必须显式告知：否则用户看到的是一个全空表单，
        // 无法区分「从未配置」与「配置还在但读不回来」（2026-10-30 反馈的现象）
        setRemote(null);
        setLoadError(err instanceof Error ? err.message : '读取配置失败');
        setLoaded(true);
      });
    return () => { cancelled = true; };
    // backend.id 变化时重新加载该后端的凭据
  }, [backend.id]);

  // 同步外部传入的 publicBaseUrl（后端对象变化时）
  useEffect(() => {
    setPublicBaseUrl(backend.s3PublicBaseUrl ?? '');
  }, [backend.s3PublicBaseUrl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveMediaS3Config({
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || 'auto',
        bucket: form.bucket.trim(),
        accessKeyId: form.accessKeyId.trim(),
        secretAccessKey: form.secretAccessKey,
        prefix: form.prefix.trim(),
      }, backend.id);
      setRemote(saved);
      setForm((f) => ({ ...f, accessKeyId: '', secretAccessKey: '' }));
      addToast({ message: `「${backend.label || backend.id}」S3 凭据已保存（加密存于服务端）`, type: 'success' });
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
      }, backend.id);
      addToast({ message: 'S3 连接成功', type: 'success' });
    } catch (err) {
      addToast({ message: `连接失败：${(err as Error).message}`, type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        支持 AWS S3 / Cloudflare R2 / 阿里 OSS / MinIO 等兼容存储。
        凭据经 HTTPS 提交后加密保存在服务端，浏览器不再明文持有；上传与删除经服务端代理执行。
      </p>
      {!loaded ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> 读取图床配置……
        </p>
      ) : (
        <>
          {loadError && (
            <p className="text-[11px] text-destructive" role="alert">
              读取服务端配置失败：{loadError}。下方表单为空白属读取异常，非「未配置」；请重试或重新保存。
            </p>
          )}
          {!loadError && !remote && (
            <p className="text-[11px] text-muted-foreground">
              尚未配置该图床凭据。填写下方表单后保存；凭据加密存于服务端，浏览器不持有明文。
            </p>
          )}
          {remote && (
            <p className="text-[11px] text-muted-foreground">
              已配置：{remote.endpoint} / {remote.bucket}（AK {remote.accessKeyIdMasked}）。留空 Secret 表示沿用已存密钥。
            </p>
          )}
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">端点 Endpoint</label>
            <input
              type="text"
              value={form.endpoint}
              onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, endpoint: e.target.value })); }}
              placeholder="https://s3.example.com 或 R2 端点"
              className={s3InputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">桶名 Bucket</label>
              <input
                type="text"
                value={form.bucket}
                onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, bucket: e.target.value })); }}
                className={s3InputClass}
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">区域 Region（可空 = auto）</label>
              <input
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
              <label className="block text-[11px] text-muted-foreground mb-1">AccessKeyId{remote ? '（留空沿用）' : ''}</label>
              <input
                type="text"
                value={form.accessKeyId}
                onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, accessKeyId: e.target.value })); }}
                className={s3InputClass}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">SecretAccessKey{remote ? '（留空沿用）' : ''}</label>
              <input
                type="password"
                value={form.secretAccessKey}
                onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, secretAccessKey: e.target.value })); }}
                className={s3InputClass}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">目录前缀（可空 = 桶根）</label>
            <input
              type="text"
              value={form.prefix}
              onChange={(e) => { dirtyRef.current = true; setForm((f) => ({ ...f, prefix: e.target.value })); }}
              placeholder="images/2026"
              className={s3InputClass}
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">公网访问基址（含 {'{path}'}；用于复制外链）</label>
            <input
              type="text"
              value={publicBaseUrl}
              onChange={(e) => {
                dirtyRef.current = true;
                const v = e.target.value.trim();
                setPublicBaseUrl(v);
                // 外链模板非敏感，存入 backend 对象（随配置同步）
                onChange({ s3PublicBaseUrl: v });
              }}
              placeholder="https://bucket.cos.ap-beijing.myqcloud.com/{path}"
              className={s3InputClass}
            />
            {publicBaseUrl && !publicBaseUrl.includes('{path}') && !publicBaseUrl.includes('{key}') && (
              <p className="mt-1 text-[11px] text-destructive" role="alert">
                基址缺少 {'{path}'} 占位符：所有外链都会指向基址本身而非图片文件，请写成 桶的公网域名/{'{path}'}
              </p>
            )}
            {publicBaseUrl.includes('{bucket}') && (
              <p className="mt-1 text-[11px] text-destructive" role="alert">
                {'{bucket}'} 会被替换成空串（外链配置不含桶名），请把完整桶域名直接写进基址
              </p>
            )}
            {/github\.com\//.test(publicBaseUrl) && (
              <p className="mt-1 text-[11px] text-destructive" role="alert">
                这里应填 S3 桶的公网访问域名（不是 GitHub 仓库地址），如 https://bucket.cos.ap-beijing.myqcloud.com/{'{path}'}
              </p>
            )}
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-sm hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              保存凭据
            </button>
          </div>
        </>
      )}
    </div>
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
  const { addToast } = useToast();
  const [newBackendKind, setNewBackendKind] = useState<MediaBackendKind>('standalone');

  const backends = mediaConfig.backends || [];
  const defaultBackendId = mediaConfig.defaultBackendId;

  /** 更新单个 backend 对象（不可变更新，保持引用稳定便于 memo） */
  const updateBackend = useCallback((id: string, patch: Partial<MediaBackend>) => {
    const next = (mediaConfig.backends || []).map((b) => (b.id === id ? { ...b, ...patch } : b));
    updateMediaConfig({ backends: next });
  }, [mediaConfig.backends, updateMediaConfig]);

  const removeBackend = useCallback((id: string) => {
    const list = mediaConfig.backends || [];
    if (list.length <= 1) {
      addToast({ message: '至少保留一个媒体仓库', type: 'warning' });
      return;
    }
    const target = list.find((b) => b.id === id);
    const next = list.filter((b) => b.id !== id);
    const nextDefault = next.find((b) => b.id === defaultBackendId) ? defaultBackendId : next[0]?.id;
    updateMediaConfig({ backends: next, defaultBackendId: nextDefault || '' });
    // S3 后端的凭据存于 Worker 侧分键：删除后端时一并清除，避免凭据孤儿留存
    if (target?.kind === 's3') {
      void deleteMediaS3Config(id).catch(() => {
        addToast({ message: '已删除本地仓库，但服务端凭据清除失败（可稍后在 Worker 侧清理）', type: 'warning' });
      });
    }
    addToast({ message: '已删除媒体仓库', type: 'success' });
  }, [mediaConfig.backends, defaultBackendId, updateMediaConfig, addToast]);

  const setDefaultBackend = useCallback((id: string) => {
    updateMediaConfig({ defaultBackendId: id });
    addToast({ message: '已设为默认后端媒体仓库', type: 'success' });
  }, [updateMediaConfig, addToast]);

  const addBackend = useCallback(() => {
    const id = newBackendId(newBackendKind);
    const meta = BACKEND_KINDS.find((k) => k.value === newBackendKind);
    const newBackend: MediaBackend = {
      id,
      kind: newBackendKind,
      label: `${meta?.label ?? newBackendKind}（新）`,
      enabled: true,
      ...(newBackendKind === 'standalone'
        ? { owner: '', repo: '', branch: 'main' }
        : newBackendKind === 'repo-dir'
          ? { pathPrefix: DEFAULT_MEDIA_PATH }
          : newBackendKind === 'image-branch'
            ? { branch: DEFAULT_BRANCH_NAME }
            : { s3PublicBaseUrl: '' }),
    };
    updateMediaConfig({ backends: [...(mediaConfig.backends || []), newBackend] });
    addToast({ message: `已添加「${meta?.label ?? newBackendKind}」，请配置后启用`, type: 'success' });
  }, [newBackendKind, mediaConfig.backends, updateMediaConfig, addToast]);

  return (
    <div className="space-y-6 max-w-xl">
      {/* —— 并行媒体仓库管理 —— */}
      <section>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
          <Image className="w-3 h-3" />
          媒体仓库（并行）
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          可同时启用多个不同类型的媒体仓库。上传时选择目标仓库，未指定则落「默认后端」；
          媒体库页初始展示默认仓库的内容。
        </p>

        <div className="space-y-2">
          {backends.map((b) => (
            <BackendItem
              key={b.id}
              backend={b}
              isDefault={b.id === defaultBackendId}
              onChange={(patch) => updateBackend(b.id, patch)}
              onRemove={() => removeBackend(b.id)}
              onSetDefault={() => setDefaultBackend(b.id)}
              disabled={backends.length <= 1}
            />
          ))}
        </div>

        <div className="flex gap-2 mt-3 pt-3 border-t border-border-subtle">
          <select
            value={newBackendKind}
            onChange={(e) => setNewBackendKind(e.target.value as MediaBackendKind)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring bg-card text-foreground"
            aria-label="新仓库类型"
          >
            {BACKEND_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={addBackend}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-sm text-foreground hover:bg-accent hover:border-foreground/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            添加仓库
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          标「<span className="text-primary-text font-medium">默认</span>」的是默认后端；上传未指定仓库时落默认后端。
        </p>
      </section>

      {/* —— CDN 域名（与 GitHub 类后端共用，S3 后端用各自 publicBaseUrl） —— */}
      <section>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-2">
          <Globe className="w-3 h-3" />
          CDN 域名
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          适用于 GitHub 类后端（独立图床仓库 / 子目录 / 独立分支）。S3 后端请在各后端配置里设置「公网访问基址」。
        </p>
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
                className="mt-0.5 accent-primary"
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
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground placeholder-muted-foreground mt-1"
              placeholder="模板变量：{owner} {repo} {branch} {path}"
            />
          )}
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
                className="mt-0.5 accent-primary"
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
            className="flex-1 accent-primary"
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
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors bg-card text-foreground font-mono placeholder-muted-foreground"
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
                className="mt-0.5 accent-primary"
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
