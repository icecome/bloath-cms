// 媒体库选择器对话框：复用媒体源解析与 CDN URL 逻辑，点击图片回传 URL
import { useState, useEffect, useMemo } from 'react';
import { useCollections } from '../../contexts/CollectionsContext';
import { useRepo } from '../../contexts/RepoContext';
import { useAuth } from '../../hooks/useAuth';
import { getTree } from '../../lib/api';
import { sortByLastModified } from '../../lib/sortFiles';
import { resolveMediaSource, mediaCdnUrl } from '../../lib/resolveMediaSource';
import { X, Loader2, AlertCircle } from 'lucide-react';

interface MediaPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
}

interface PickerItem {
  path: string;
  url: string;
}

export default function MediaPickerDialog({ open, onClose, onPick }: MediaPickerDialogProps) {
  const { user } = useAuth();
  const { mediaConfig } = useCollections();
  const { selectedRepo } = useRepo();
  const source = useMemo(() => resolveMediaSource(mediaConfig, selectedRepo), [mediaConfig, selectedRepo]);
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !user || !source.configured) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    getTree({ owner: source.owner, repo: source.repo, branch: source.branch, mode: 'filename' })
      .then((treeItems) => {
        if (cancelled) return;
        const filtered = treeItems
          .filter((f) => (!source.pathPrefix || f.path.startsWith(source.pathPrefix + '/')) &&
            /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name));
        const sorted = sortByLastModified(filtered);
        const media = sorted.map((f) => ({ path: f.path, url: mediaCdnUrl(source, mediaConfig, f.path) }));
        setItems(media);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '媒体库加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, user, source, mediaConfig]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-card rounded-md shadow-lg w-full max-w-2xl mx-4 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">从媒体库选择图片</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!source.configured ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {source.missingHint || '媒体源未配置'}
            </p>
          ) : loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </p>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">媒体库暂无图片</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {items.map((item) => (
                <button
                  key={item.path}
                  onClick={() => { onPick(item.url); onClose(); }}
                  className="group relative aspect-square rounded-sm overflow-hidden border border-border hover:border-primary transition-colors"
                  title={item.path}
                >
                  <img src={item.url} alt={item.path} className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
