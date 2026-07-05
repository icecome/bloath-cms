import { useState, useRef, useCallback, useEffect } from 'react';
import { useCollections } from '../contexts/CollectionsContext';
import { useAuth } from '../hooks/useAuth';
import { getTree, uploadImage, deleteFile } from '../lib/api';
import { resolveRenameTemplate } from '../lib/rename';
import {
  Upload,
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

interface MediaFile {
  name: string;
  path: string;
  sha: string;
  size?: number;
  url: string;
  lastModified: number;
}

export default function MediaPage() {
  const { token, user } = useAuth();
  const { mediaConfig } = useCollections();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'markdown' | null>(null);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [gridCols, setGridCols] = useState(() => {
    const saved = localStorage.getItem('media-grid-cols');
    return saved ? parseInt(saved, 10) : 5;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteConfirm, setDeleteConfirm] = useState<MediaFile | null>(null);
  const PAGE_SIZE = 40;

  const isConfigured = mediaConfig.imageOwner && mediaConfig.imageRepo;

  const handleGridColsChange = (value: number) => {
    setGridCols(value);
    localStorage.setItem('media-grid-cols', String(value));
  };

  const getCdnUrl = useCallback((path: string) => {
    const { cdnProvider, customCdnTemplate, imageOwner, imageRepo } = mediaConfig;
    if (cdnProvider === 'custom') {
      return customCdnTemplate
        .replace('{owner}', imageOwner)
        .replace('{repo}', imageRepo)
        .replace('{path}', path);
    }
    if (cdnProvider === 'jsdelivr') {
      return `https://cdn.jsdelivr.net/gh/${imageOwner}/${imageRepo}@main/${path}`;
    }
    return `https://raw.githubusercontent.com/${imageOwner}/${imageRepo}/main/${path}`;
  }, [mediaConfig]);

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    if (!token || !isConfigured) return;
    setLoading(true);
    setError('');
    try {
      const treeItems = await getTree(token, {
        owner: mediaConfig.imageOwner,
        repo: mediaConfig.imageRepo,
        branch: 'main'
      });

      const mediaFiles: MediaFile[] = treeItems
        .filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name))
        .map((f) => ({
          name: f.name,
          path: f.path,
          sha: f.sha,
          size: f.size,
          url: getCdnUrl(f.path),
          lastModified: f.lastModified || 0
        }))
        .sort((a, b) => b.lastModified - a.lastModified);
      setFiles(mediaFiles);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, isConfigured, mediaConfig, getCdnUrl]);

  // 静默加载文件列表（不显示 loading/error）
  const loadFilesSilently = useCallback(async (): Promise<MediaFile[] | null> => {
    if (!token || !isConfigured) return null;
    try {
      const treeItems = await getTree(token, {
        owner: mediaConfig.imageOwner,
        repo: mediaConfig.imageRepo,
        branch: 'main'
      });
      return treeItems
        .filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name))
        .map((f) => ({
          name: f.name,
          path: f.path,
          sha: f.sha,
          size: f.size,
          url: getCdnUrl(f.path),
          lastModified: f.lastModified || 0
        }))
        .sort((a, b) => b.lastModified - a.lastModified);
    } catch {
      return null;
    }
  }, [token, isConfigured, mediaConfig, getCdnUrl]);

  useEffect(() => {
    if (isConfigured) loadFiles();
  }, [isConfigured, loadFiles]);

  // 压缩图片为 WebP
  const compressImage = (file: File, quality: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas 不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob);
            else reject(new Error('压缩失败'));
          },
          'image/webp',
          quality / 100
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败'));
      };
      img.src = url;
    });
  };

  // 上传文件
  const handleUpload = async (fileList: FileList | File[]) => {
    if (!token || !user || !isConfigured) return;

    const filesArray = Array.from(fileList).filter((f) =>
      f.type.startsWith('image/')
    );
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

    for (const file of filesArray) {
      try {
        const blob = await compressImage(file, mediaConfig.quality);
        const base64 = await blobToBase64(blob);

        const fileName = resolveRenameTemplate(mediaConfig.renameTemplate, file.name) + '.webp';
        const filePath = fileName;

        // 上传前重新加载文件列表以确保存在性检查准确
        const currentFiles = await loadFilesSilently();
        const exists = currentFiles?.some((f) => f.name === fileName);
        if (exists && mediaConfig.duplicateStrategy === 'skip') {
          skipped++;
          continue;
        }

        let sha: string | undefined;
        if (exists) {
          const existing = currentFiles?.find((f) => f.name === fileName);
          sha = existing?.sha;
        }

        await uploadImage(token, {
          owner: mediaConfig.imageOwner,
          repo: mediaConfig.imageRepo,
          path: filePath,
          base64Content: base64,
          message: `[skip ci] 上传: ${fileName}`,
          branch: 'main',
          userName: user.login,
          sha
        });
        uploaded++;
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 删除文件
  const handleDelete = async (file: MediaFile) => {
    if (!token || !user) return;
    setDeleteConfirm(file);
  };

  // 执行删除
  const executeDelete = async () => {
    const file = deleteConfirm;
    if (!file || !token || !user) return;
    setDeleteConfirm(null);

    try {
      await deleteFile(token, {
        owner: mediaConfig.imageOwner,
        repo: mediaConfig.imageRepo,
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

  // 复制 URL
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

  // 复制 Markdown 链接
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

  // 拖拽处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '-';
    const d = new Date(timestamp);
    const Y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${Y}-${m}-${day} ${h}:${min}:${s}`;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isConfigured) {
    return (
      <div className="flex-1 overflow-auto">
        <header className="px-8 py-5 flex-shrink-0">
          <h1 className="text-base font-medium text-[#1F1F1F]">媒体库</h1>
          <p className="text-sm text-[#6B7280] mt-1">管理图片和静态资源</p>
        </header>
        <div className="px-8">
          <div className="border border-[#E8E8E8] rounded-sm p-12 text-center">
            <ImageIcon className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
            <p className="text-sm text-[#6B7280] mb-1">请先配置图床仓库</p>
            <p className="text-xs text-[#9CA3AF]">前往设置页配置图床仓库和 CDN 域名后即可使用</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* 顶部栏 */}
      <header className="px-8 py-5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-medium text-[#1F1F1F]">媒体库</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              {mediaConfig.imageOwner}/{mediaConfig.imageRepo} · {files.length} 个文件
            </p>
          </div>
          {/* 每行个数滑块 */}
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="w-4 h-4 text-[#9CA3AF]" />
            <span className="text-xs text-[#6B7280] w-16">每行 {gridCols} 个</span>
            <input
              type="range"
              min={5}
              max={10}
              value={gridCols}
              onChange={(e) => handleGridColsChange(parseInt(e.target.value, 10))}
              className="w-24 h-1 accent-[#3B82F6] cursor-pointer"
            />
          </div>
        </div>
      </header>

      <div className="px-8 space-y-4">
        {/* 消息提示 */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-sm text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto"><X className="w-3 h-3" /></button>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-sm text-xs text-green-700">
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{success}</span>
            <button onClick={() => setSuccess('')} className="ml-auto"><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* 上传区域 */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-[#3B82F6] bg-blue-50'
              : 'border-[#E8E8E8] hover:border-[#D1D5DB] hover:bg-[#F9FAFA]'
          } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
          {uploading ? (
            <Loader2 className="w-8 h-8 text-[#3B82F6] mx-auto mb-2 animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-[#9CA3AF] mx-auto mb-2" />
          )}
          <p className="text-sm text-[#6B7280]">
            {uploading ? '上传中...' : '拖拽图片到此处，或点击选择文件'}
          </p>
          <p className="text-xs text-[#9CA3AF] mt-1">
            自动压缩为 WebP · 质量 {mediaConfig.quality}% · 自动重命名
          </p>
        </div>

        {/* 文件列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-[#3B82F6] animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-sm text-[#9CA3AF]">
            暂无图片，上传第一张图片开始使用
          </div>
        ) : (
          <>
            <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
              {files.slice(0, currentPage * PAGE_SIZE).map((file) => (
              <div
                key={file.path}
                className="group border border-[#E8E8E8] rounded-sm overflow-hidden hover:border-[#D1D5DB] transition-colors bg-white"
              >
                {/* 缩略图 */}
                <div
                  className="aspect-square bg-[#F9FAFA] flex items-center justify-center cursor-pointer overflow-hidden"
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
                  <FileImage className="w-8 h-8 text-[#D1D5DB] hidden" />
                </div>

                {/* 文件信息 */}
                <div className="px-2 py-1.5 border-t border-[#F2F2F2]">
                  <p className="text-xs text-[#1F1F1F] truncate font-mono" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-[#9CA3AF]">{formatSize(file.size)} · {formatDate(file.lastModified)}</p>
                </div>

                {/* 操作按钮 */}
                <div className="px-2 pb-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleCopy(file)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-[#E8E8E8] rounded-sm hover:bg-[#F9FAFA] transition-colors text-[#6B7280]"
                    title="复制 URL"
                  >
                    {copiedId === file.sha && copiedType === 'url' ? (
                      <Check className="w-3 h-3 text-green-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    onClick={() => handleCopyMarkdown(file)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border border-[#E8E8E8] rounded-sm hover:bg-[#F9FAFA] transition-colors text-[#6B7280]"
                    title="复制 Markdown 链接"
                  >
                    {copiedId === file.sha && copiedType === 'markdown' ? (
                      <Check className="w-3 h-3 text-green-600" />
                    ) : (
                      <span className="text-[10px] font-bold">#</span>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(file)}
                    className="flex items-center justify-center px-2 py-1 border border-[#E8E8E8] rounded-sm hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-[#6B7280]"
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
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="px-6 py-2 text-sm bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors"
                >
                  加载更多 ({files.length - currentPage * PAGE_SIZE} 张剩余)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-sm shadow-sm p-4 w-full max-w-sm mx-4 border border-[#E8E8E8]">
            <p className="text-sm text-[#1F1F1F] mb-4">
              确定要删除 <span className="font-mono text-[#6B7280]">{deleteConfirm.name}</span> 吗？
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-sm border border-[#E8E8E8] text-[#374151] hover:bg-[#F9FAFA] rounded-sm transition-colors"
              >
                取消
              </button>
              <button
                onClick={executeDelete}
                className="px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-sm transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗 */}
      {previewFile && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="bg-white rounded-sm max-w-3xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#F2F2F2]">
              <p className="text-sm font-medium text-[#1F1F1F] truncate font-mono">{previewFile.name}</p>
              <button
                onClick={() => setPreviewFile(null)}
                className="text-[#6B7280] hover:text-[#1F1F1F] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-[#F9FAFA]">
              <img
                src={previewFile.url}
                alt={previewFile.name}
                className="max-w-full max-h-[60vh] object-contain"
              />
            </div>
            <div className="px-4 py-3 border-t border-[#F2F2F2] space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-[#1F1F1F] font-mono bg-[#F3F4F6] px-2 py-1 rounded-sm truncate">
                  {previewFile.url}
                </code>
                <button
                  onClick={() => handleCopy(previewFile)}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors"
                >
                  {copiedId === previewFile.sha && copiedType === 'url' ? (
                    <><Check className="w-3 h-3" /> 已复制</>
                  ) : (
                    <><Copy className="w-3 h-3" /> URL</>
                  )}
                </button>
                <button
                  onClick={() => handleCopyMarkdown(previewFile)}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors"
                >
                  {copiedId === previewFile.sha && copiedType === 'markdown' ? (
                    <><Check className="w-3 h-3" /> 已复制</>
                  ) : (
                    <><span className="text-[10px] font-bold">#</span> MD</>
                  )}
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
                <span>{formatSize(previewFile.size)} · 修改于 {formatDate(previewFile.lastModified)}</span>
                <button
                  onClick={() => { handleDelete(previewFile); setPreviewFile(null); }}
                  className="flex items-center gap-1 text-red-600 hover:text-red-700 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> 删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 工具函数：Blob 转 Base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.substring(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('Base64 转换失败'));
    reader.readAsDataURL(blob);
  });
}
