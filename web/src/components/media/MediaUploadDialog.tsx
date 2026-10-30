// 上传弹窗：替代媒体库页内的常驻拖放区。
//
// 设计要点（见 docs/02-tech-designs/media-library-upgrade-design.md）：
//   · 拖放区 + 文件队列 + 本次上传配置三段。
//   · 配置「仅本次生效」：压缩/原图、压缩质量、重命名模板都是弹窗内的局部状态，
//     不从设置页读死值，也不在关闭后写回 —— 设置页仍是默认值的唯一权威（D2）。
//   · 保存后的文件名实时预览：避免「.webp 路径里躺着 JPEG 字节」的错配，
//     并让重命名模板的效果在提交前可见。
//   · 只接受图片：当前阶段不开放视频上传（见设计方案需求 1）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Upload, X, AlertCircle, Image as ImageIcon } from 'lucide-react';
import type { UploadMode } from '../../../../shared/types';
import Modal from '../ui/Modal';
import { formatSize } from '../../lib/mediaUtils';
import { fillTemplate, migrateLegacyTemplate } from '../../lib/template';
import { sanitizeMediaFileName } from '../../lib/mediaUtils';
import { planUpload } from '../../lib/mediaUploadPlan';

/** 只接受图片：视频上传当前不开放 */
const IMAGE_ACCEPT = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic', '.heif',
].join(',');

/** 压缩质量允许范围（与设置页滑块保持一致） */
const QUALITY_MIN = 50;
const QUALITY_MAX = 100;

/** 源文件扩展名（预览兜底用）：无扩展名文件回退 'jpg'，避免拼出 'noext.noext' */
function sourceExtOf(file: File): string {
  return file.name.includes('.')
    ? (file.name.split('.').pop() || 'jpg').toLowerCase()
    : 'jpg';
}

interface MediaUploadDialogProps {
  open: boolean;
  onClose: () => void;
  /** 设置页的默认值：弹窗打开时作为初值，修改不写回 */
  defaultMode: UploadMode;
  defaultQuality: number;
  defaultRenameTemplate: string;
  /** 执行上传；返回成功上传的文件集合（用于按差集裁剪重试队列） */
  onUpload: (
    files: File[],
    options: { mode: UploadMode; quality: number; renameTemplate: string }
  ) => Promise<Set<File>>;
  uploading: boolean;
  /** 上传失败信息（多行分条），由管线提供 */
  error: string;
  onClearError: () => void;
}

export function MediaUploadDialog({
  open,
  onClose,
  defaultMode,
  defaultQuality,
  defaultRenameTemplate,
  onUpload,
  uploading,
  error,
  onClearError,
}: MediaUploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  // 本次上传配置：仅弹窗存活期间有效
  const [mode, setMode] = useState<UploadMode>(defaultMode);
  const [quality, setQuality] = useState(defaultQuality);
  const [renameTemplate, setRenameTemplate] = useState(defaultRenameTemplate);

  // 每次打开重置为设置页默认值 —— 上一次的临时修改不残留
  useEffect(() => {
    if (!open) return;
    setQueue([]);
    setRejectNote('');
    setMode(defaultMode);
    setQuality(defaultQuality);
    setRenameTemplate(defaultRenameTemplate);
  }, [open, defaultMode, defaultQuality, defaultRenameTemplate]);

  const migratedTemplate = useMemo(
    () => migrateLegacyTemplate(renameTemplate || '{{filename}}'),
    [renameTemplate]
  );

  /**
   * 文件名预览：与上传执行路径（hooks/useMediaUpload）共用同一套决策。
   *
   * 关键：扩展名必须来自 planUpload 的 plan.ext，不能自己按「压缩→webp / 原图→源扩展名」
   * 拍。执行层会把 .jpeg 归一成 .jpg、GIF/SVG 强制原图、HEIC/AVIF 动态照片强制原图，
   * 自己拍会得到「预览 a.jpeg 实际落地 a.jpg」这类错配。
   *
   * 已知残余差异（无法在预览期消除，属信息不足而非逻辑分歧）：
   *   · 「压缩无收益回退原图」需要真正压缩一次才知道结果，预览期只能显示压缩后的 .webp。
   *     执行层会在 notes 里告知用户实际保留了原图。
   */
  const [previewExts, setPreviewExts] = useState<Map<File, string>>(new Map());

  useEffect(() => {
    if (queue.length === 0) {
      setPreviewExts(new Map());
      return;
    }
    // 队列或模式变化后重新推演；cancelled 防止旧批次结果覆盖新批次（§6.2 模式 A）
    let cancelled = false;
    void (async () => {
      const next = new Map<File, string>();
      for (const file of queue) {
        try {
          const plan = await planUpload(file, mode, { isS3: false });
          next.set(file, plan.ext);
        } catch {
          // 被拒绝的文件不会进入上传流程，预览保持源扩展名
        }
      }
      if (!cancelled) setPreviewExts(next);
    })();
    return () => { cancelled = true; };
  }, [queue, mode]);

  /** 文件名预览：模板填充 → 清洗 → 拼 planUpload 决定的扩展名 */
  const previewName = useCallback(
    (file: File): string => {
      const base = sanitizeMediaFileName(
        fillTemplate(migratedTemplate, { filename: file.name })
      );
      const ext = previewExts.get(file) ?? sourceExtOf(file);
      return `${base}.${ext}`;
    },
    [migratedTemplate, previewExts]
  );

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    // 只保留图片：非图片文件（含视频）在此拦截并给出一次性提示
    const images = incoming.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp|avif|heic|heif)$/i.test(f.name));
    const rejected = incoming.length - images.length;
    if (rejected > 0) {
      setRejectNote(`已忽略 ${rejected} 个非图片文件：当前仅支持上传图片`);
    } else {
      setRejectNote('');
    }
    if (images.length > 0) {
      setQueue((prev) => [...prev, ...images]);
    }
  }, []);

  const openPicker = () => fileInputRef.current?.click();

  const handleSubmit = async () => {
    if (queue.length === 0 || uploading) return;
    onClearError();
    const succeeded = await onUpload(queue, { mode, quality, renameTemplate: migratedTemplate });
    // 按成功集合裁剪：管线对图片/视频分组并发执行，成功顺序 ≠ 队列顺序，
    // 按计数裁剪会留下已成功的、移除已失败的（审查 m-01）
    const remaining = queue.filter((f) => !succeeded.has(f));
    if (remaining.length === 0) {
      onClose();
    } else {
      setQueue(remaining);
    }
  };

  if (!open) return null;

  return (
    <Modal
      labelledBy="media-upload-title"
      onClose={uploading ? () => {} : onClose}
      className="bg-card rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <h3 id="media-upload-title" className="text-sm font-medium text-foreground">上传图片</h3>
        <button
          type="button"
          onClick={onClose}
          disabled={uploading}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {/* 拖放区：点击与键盘都可触发 */}
        <div
          role="button"
          tabIndex={uploading ? -1 : 0}
          aria-label="选择图片：点击或拖拽文件到此处"
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files).filter((f) => f.type !== '' || f.size > 0);
            addFiles(files);
          }}
          className={`border border-dashed border-border rounded-sm px-4 py-6 text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            dragOver ? 'bg-primary/5' : 'hover:bg-accent'
          } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(Array.from(e.target.files));
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          {uploading ? (
            <Loader2 className="w-6 h-6 text-primary mx-auto mb-1.5 animate-spin" />
          ) : (
            <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-1.5" />
          )}
          <p className="text-sm text-muted-foreground">
            {uploading ? '上传中……' : '拖拽文件到此处，或点击选择'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            JPG / PNG / GIF / WebP / SVG / AVIF / HEIC
          </p>
        </div>

        {rejectNote && (
          <p className="text-xs text-warning flex items-center gap-1.5" role="status">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {rejectNote}
          </p>
        )}

        {/* 文件队列 */}
        {queue.length > 0 && (
          <ul className="space-y-1.5" aria-label="待上传文件">
            {queue.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center gap-2 px-2.5 py-2 bg-accent/50 border border-border-subtle rounded-sm"
              >
                <ImageIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground font-mono truncate flex-1 min-w-0" title={file.name}>
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                  {formatSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => setQueue((prev) => prev.filter((_, i) => i !== index))}
                  disabled={uploading}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-40"
                  aria-label={`移除 ${file.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 本次上传配置 */}
        <div className="pt-3 border-t border-border space-y-3">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-medium text-foreground">本次上传配置</span>
            <span className="text-xs text-muted-foreground">仅在本次生效，不覆盖设置页默认值</span>
          </div>

          {/* 上传方式 */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-16 flex-shrink-0" id="upload-mode-label">
              上传方式
            </span>
            <div role="radiogroup" aria-labelledby="upload-mode-label" className="flex items-center gap-1.5">
              {([
                { value: 'compress' as const, label: '压缩' },
                { value: 'original' as const, label: '原图' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  disabled={uploading}
                  onClick={() => setMode(value)}
                  className={`px-3 py-1 text-xs border rounded-sm transition-colors disabled:opacity-50 disabled:pointer-events-none ${
                    mode === value
                      ? 'bg-foreground text-background border-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 压缩质量：仅压缩模式可调 */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="upload-quality"
              className={`text-xs w-16 flex-shrink-0 ${mode === 'compress' ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}
            >
              压缩质量
            </label>
            <input
              id="upload-quality"
              type="range"
              min={QUALITY_MIN}
              max={QUALITY_MAX}
              step={1}
              value={quality}
              disabled={mode !== 'compress' || uploading}
              onChange={(e) => setQuality(parseInt(e.target.value, 10))}
              className="flex-1 h-1 accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              aria-describedby="upload-quality-hint"
            />
            <span className="text-xs text-foreground tabular-nums w-9 text-right flex-shrink-0">{quality}%</span>
          </div>
          <p id="upload-quality-hint" className="text-xs text-muted-foreground pl-20">
            {mode === 'compress'
              ? `图片转 WebP，最长边 4096px；设置页默认 ${defaultQuality}%`
              : '保留原始格式与画质，体积更大'}
          </p>

          {/* 重命名模板 */}
          <div className="flex items-center gap-3">
            <label htmlFor="upload-template" className="text-xs text-muted-foreground w-16 flex-shrink-0">
              重命名模板
            </label>
            <input
              id="upload-template"
              type="text"
              value={renameTemplate}
              disabled={uploading}
              onChange={(e) => setRenameTemplate(e.target.value)}
              placeholder="{{filename}}"
              className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono bg-card text-foreground border border-border rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors disabled:opacity-50"
              aria-describedby="upload-template-hint"
            />
          </div>
          <p id="upload-template-hint" className="text-xs text-muted-foreground pl-20">
            支持 <code className="font-mono">{'{{filename}}'}</code>、
            <code className="font-mono">{'{{date:YYYY}}'}</code>、
            <code className="font-mono">{'{{random:6}}'}</code>；设置页默认{' '}
            <code className="font-mono">{migrateLegacyTemplate(defaultRenameTemplate) || '{{filename}}'}</code>
          </p>

          {/* 保存后的文件名预览 */}
          {queue.length > 0 && (
            <div className="flex items-start gap-3">
              <span className="text-xs text-muted-foreground w-16 flex-shrink-0 pt-1">保存为</span>
              <ul className="flex-1 min-w-0 space-y-1">
                {queue.slice(0, 3).map((file, index) => (
                  <li key={`preview-${index}`} className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-foreground truncate flex-1 min-w-0" title={previewName(file)}>
                      {previewName(file)}
                    </span>
                    {mode === 'compress' && (
                      <span className="text-[10px] px-1 py-0.5 rounded-sm bg-success/10 text-success flex-shrink-0">
                        压缩
                      </span>
                    )}
                  </li>
                ))}
                {queue.length > 3 && (
                  <li className="text-xs text-muted-foreground">…等 {queue.length} 个文件</li>
                )}
              </ul>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border border-destructive/25 rounded-sm text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="whitespace-pre-line flex-1">{error}</span>
            <button type="button" onClick={onClearError} className="flex-shrink-0" aria-label="关闭错误提示">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {queue.length > 0 ? `已选 ${queue.length} 个文件` : '尚未选择文件'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:bg-accent transition-colors disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={queue.length === 0 || uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {uploading && <Loader2 className="w-3 h-3 animate-spin" />}
            {uploading ? '上传中……' : `上传 ${queue.length} 张图片`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
