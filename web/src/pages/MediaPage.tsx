import { useState, useCallback, useEffect, useMemo } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { useRepo } from '../contexts/RepoContext';
import { useAuth } from '../hooks/useAuth';
import { getTree, uploadImage, deleteFile } from '../lib/api';
import { resolveMediaSource } from '../lib/resolveMediaSource';
import { sortByLastModified } from '../lib/sortFiles';
import { resolveRenameTemplate } from '../lib/rename';
import {
  compressImage,
  blobToBase64,
  formatDate,
  formatSize,
  PAGE_SIZE,
  MAX_FILE_SIZE,
  type MediaFile
} from '../lib/mediaUtils';
import { MediaUploader } from '../components/media/MediaUploader';
import { MediaPreviewDialog } from '../components/media/MediaPreviewDialog';
import { DeleteConfirmDialog } from '../components/media/DeleteConfirmDialog';
import {
  Image as ImageIcon,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  X,
  Loader2,
  FileImage,
  SlidersHorizontal
} from 'lucide-react';

export default function MediaPage() {
  const { user } = useAuth();
  const { mediaConfig } = useCollections();
  const { selectedRepo } = useRepo();
  const source = useMemo(() => resolveMediaSource(mediaConfig, selectedRepo), [mediaConfig, selectedRepo]);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'markdown' | null>(null);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [gridCols, setGridCols] = useState(() => {
    const saved = localStorage.getItem('media-grid-cols');
    return saved ? parseInt(saved, 10) : 5;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirm, setDeleteConfirm] = useState<MediaFile | null>(null);

  const isConfigured = source.configured;

  const handleGridColsChange = (value: number) => {
    setGridCols(value);
    localStorage.setItem('media-grid-cols', String(value));
  };

  // 构建 CDN URL，custom 模板支持 {branch} 占位符
  const getCdnUrl = useCallback((path: string) => {
    const { cdnProvider, customCdnTemplate } = mediaConfig;
    const { owner, repo, branch } = source;
    if (cdnProvider === 'custom') {
      return customCdnTemplate
        .replace('{owner}', owner)
        .replace('{repo}', repo)
        .replace('{branch}', branch)
        .replace('{path}', path);
    }
    if (cdnProvider === 'jsdmirror') {
      return `https://cdn.jsdmirror.cn/gh/${owner}/${repo}@${branch}/${path}`;
    }
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }, [mediaConfig, source]);

  // 加载文件列表；silent=true 时不更新 loading/error 状态并返回结果
  const loadFiles = useCallback(async (silent = false): Promise<MediaFile[] | null> => {
    if (!user || !isConfigured) return null;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const treeItems = await getTree({
        owner: source.owner,
        repo: source.repo,
        branch: source.branch,
        mode: 'filename'
      });

      const mediaFiles: MediaFile[] = treeItems.filter((f) => {
        if (source.pathPrefix && !f.path.startsWith(source.pathPrefix + '/')) {
          return false;
        }
        return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name);
      })
        .map((f) => ({
          name: f.name,
          path: f.path,
          sha: f.sha,
          size: f.size,
          url: getCdnUrl(f.path),
          lastModified: f.lastModified || 0
        }));
      sortByLastModified(mediaFiles);

      if (silent) {
        return mediaFiles;
      }
      setFiles(mediaFiles);
      setCurrentPage(1);
      return mediaFiles;
    } catch (err) {
      if (silent) {
        return null;
      }
      setError(err instanceof Error ? err.message : '加载失败');
      return null;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [user, isConfigured, source, getCdnUrl]);

  useEffect(() => {
    if (isConfigured) loadFiles();
  }, [isConfigured, loadFiles]);

  // 上传文件
  const handleUpload = async (fileList: FileList | File[]) => {
    if (!user || !isConfigured) return;

    const filesArray = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (filesArray.length === 0) {
      setError('请选择图片文件');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    let uploaded = 0;
    let skipped = 0;
    const errors: string[] = [];

    let currentFiles = await loadFiles(true);

    for (const file of filesArray) {
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: 超过 20MB 限制`);
        continue;
      }
      try {
        const blob = await compressImage(file, mediaConfig.quality);
        const base64 = await blobToBase64(blob);

        const fileName = resolveRenameTemplate(mediaConfig.renameTemplate, file.name) + '.webp';
        const filePath = source.pathPrefix
          ? `${source.pathPrefix}/${fileName}`
          : fileName;

        const existing = currentFiles?.find((f) => f.name === fileName);
        if (existing && mediaConfig.duplicateStrategy === 'skip') {
          skipped++;
          continue;
        }

        await uploadImage({
          owner: source.owner,
          repo: source.repo,
          path: filePath,
          base64Content: base64,
          message: `[skip ci] 上传: ${fileName}`,
          branch: source.branch,
          userName: user.login,
          sha: existing?.sha
        });
        uploaded++;
        // 上传成功后更新本地缓存
        if (currentFiles) {
          const newEntry: MediaFile = {
            name: fileName,
            path: filePath,
            sha: existing?.sha || '',
            size: blob.size,
            lastModified: Date.now(),
            url: getCdnUrl(filePath)
          };
          currentFiles = [newEntry, ...currentFiles];
        }
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : '上传失败'}`);
      }
    }

    if (uploaded > 0) {
      setSuccess(`成功上传 ${uploaded} 张图片${skipped > 0 ? `，跳过 ${skipped} 张` : ''}`);
      await loadFiles();
    }
    if (errors.length > 0) {
      setError(errors.join('; '));
    }

    setUploading(false);
  };

  const handleDelete = (file: MediaFile) => {
    if (!user) return;
    setDeleteConfirm(file);
  };

  const executeDelete = async () => {
    const file = deleteConfirm;
    if (!file || !user) return;
    setDeleteConfirm(null);

    try {
      await deleteFile({
        owner: source.owner,
        repo: source.repo,
        path: file.path,
        sha: file.sha,
        message: `[skip ci] 删除: ${file.name}`,
        userName: user.login
      });
      setFiles((prev) => prev.filter((f) => f.sha !== file.sha));
      setSuccess(`已删除 ${file.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleCopy = async (file: MediaFile) => {
    try {
      await navigator.clipboard.writeText(file.url);
      setCopiedId(file.sha);
      setCopiedType('url');
      setTimeout(() => { setCopiedId(null); setCopiedType(null); }, 2000);
    } catch {
      setError('复制失败');
    }
  };

  const handleCopyMarkdown = async (file: MediaFile) => {
    const markdownLink = `![${file.name}](${file.url})`;
    try {
      await navigator.clipboard.writeText(markdownLink);
      setCopiedId(file.sha);
      setCopiedType('markdown');
      setTimeout(() => { setCopiedId(null); setCopiedType(null); }, 2000);
    } catch {
      setError('复制失败');
    }
  };

  if (!isConfigured) {
    return (
      <div className="flex-1 overflow-auto">
        <header className="px-8 py-5 flex-shrink-0">
          <h1 className="text-base font-medium text-foreground">媒体库</h1>
          <p className="text-sm text-muted-foreground mt-1">管理图片和静态资源</p>
        </header>
        <div className="px-8">
          <div className="border border-border rounded-sm p-12 text-center">
            <ImageIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">{source.missingHint || '请先完成媒体库配置'}</p>
            <p className="text-xs text-muted-foreground">前往设置页配置媒体源后即可使用</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <header className="px-8 py-5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-medium text-foreground">媒体库</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {source.owner}/{source.repo} · {files.length} 个文件
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground w-16 hidden sm:inline">每行 {gridCols} 个</span>
            <input
              type="range"
              min={5}
              max={10}
              value={gridCols}
              onChange={(e) => handleGridColsChange(parseInt(e.target.value, 10))}
              className="w-24 h-1 accent-primary cursor-pointer hidden sm:block"
            />
          </div>
        </div>
      </header>

      <div className="px-8 space-y-4">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-sm text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="ml-auto" aria-label="关闭错误提示"><X className="w-3 h-3" /></button>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-sm text-xs text-green-700">
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{success}</span>
            <button type="button" onClick={() => setSuccess('')} className="ml-auto" aria-label="关闭成功提示"><X className="w-3 h-3" /></button>
          </div>
        )}

        <MediaUploader
          uploading={uploading}
          quality={mediaConfig.quality}
          onUpload={handleUpload}
        />

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            暂无图片，上传第一张图片开始使用
          </div>
        ) : (
          <>
            <div
              className="columns-3 column-gap-3 sm:grid sm:gap-3"
              style={{
                gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
              }}
            >
            {files.slice(0, currentPage * PAGE_SIZE).map((file) => (
            <div
              key={file.path}
              className="group border border-border rounded-sm overflow-hidden hover:border-border transition-colors bg-card mb-3 sm:mb-0 break-inside-avoid"
            >
                <div
                  className="aspect-square bg-accent flex items-center justify-center cursor-pointer overflow-hidden"
                  onClick={() => setPreviewFile(file)}
                >
                  <img
                    src={file.url}
                    alt={file.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <FileImage className="w-8 h-8 text-muted-foreground hidden" />
                </div>

                <div className="px-2 py-1.5 border-t border-border">
                  <p className="text-xs text-foreground truncate font-mono" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.size)} · {formatDate(file.lastModified)}</p>
                </div>

                <div className="px-2 pb-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleCopy(file)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-border rounded-sm hover:bg-accent transition-colors text-muted-foreground"
                    title="复制 URL"
                  >
                    {copiedId === file.sha && copiedType === 'url' ? (
                      <Check className="w-3 h-3 text-green-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyMarkdown(file)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-border rounded-sm hover:bg-accent transition-colors text-muted-foreground"
                    title="复制 Markdown 链接"
                  >
                    {copiedId === file.sha && copiedType === 'markdown' ? (
                      <Check className="w-3 h-3 text-green-600" />
                    ) : (
                      <span className="text-[10px] font-bold">#</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(file)}
                    className="flex items-center justify-center px-2 py-1 border border-border rounded-sm hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-muted-foreground"
                    title="删除"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
            {files.length > currentPage * PAGE_SIZE && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="px-6 py-2 text-sm bg-foreground text-white rounded-sm hover:bg-foreground/90 transition-colors"
                >
                  加载更多 ({files.length - currentPage * PAGE_SIZE} 张剩余)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <DeleteConfirmDialog
        file={deleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={executeDelete}
      />

      <MediaPreviewDialog
        file={previewFile}
        copiedId={copiedId}
        copiedType={copiedType}
        onClose={() => setPreviewFile(null)}
        onCopyUrl={handleCopy}
        onCopyMarkdown={handleCopyMarkdown}
        onDelete={handleDelete}
      />
    </div>
  );
}
