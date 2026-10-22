// 全局搜索对话框（P2-5）：跨内容库/草稿/回收站的标题与标签匹配。
//
// 数据源：各列表页预热的三级缓存——
// 1. 各内容路径的内存文件缓存（fileCache.getCachedFiles）；
// 2. 树级快照（fileSnapshot.readSnapshot，跨会话持久）；
// 3. 兜底：全部无数据时提示「先访问对应页面建立索引」。
// 搜索过程零网络请求。
import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Loader2 } from 'lucide-react';
import type { SelectedRepo } from '../../../../shared/types';
import type { EnhancedFileItem } from '../../lib/extractFrontMatter';
import { searchEntries, type GlobalSearchResult } from '../../lib/globalSearch';
import { getCachedFiles } from '../../lib/fileCache';
import { readSnapshot } from '../../lib/fileSnapshot';
import { buildEditUrl } from '../../lib/navigation';
import Modal from '../ui/Modal';

interface GlobalSearchDialogProps {
  open: boolean;
  onClose: () => void;
  repo: SelectedRepo;
  /** 参与搜索的内容路径（CollectionsContext 的 paths） */
  contentPaths: string[];
  /** 草稿目录（编辑目标定位用） */
  draftPath?: string;
}

/** 合并三级缓存中的条目（按 path 去重，内存缓存优先——含更新的 previewState 等叠加态） */
function collectIndexedItems(repo: SelectedRepo, contentPaths: string[]): EnhancedFileItem[] {
  const byPath = new Map<string, EnhancedFileItem>();

  // 1) 内存文件缓存（列表页访问过即有，含缓冲叠加态）
  for (const base of contentPaths) {
    const cached = getCachedFiles(repo, base);
    if (cached) {
      for (const item of cached) {
        if (item && !byPath.has(item.path)) byPath.set(item.path, item);
      }
    }
  }

  // 2) 树级快照兜底（刷新后内存缓存为空，快照仍可用）
  if (byPath.size === 0) {
    const snapshot = readSnapshot(repo);
    for (const record of Object.values(snapshot.records)) {
      byPath.set(record.item.path, { ...record.item });
    }
  }

  return [...byPath.values()];
}

export function GlobalSearchDialog({ open, onClose, repo, contentPaths, draftPath }: GlobalSearchDialogProps) {
  const navigate = useNavigate();
  const [terms, setTerms] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [indexSize, setIndexSize] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦并建立索引
  useEffect(() => {
    if (open) {
      setTerms('');
      setResults([]);
      const items = collectIndexedItems(repo, contentPaths);
      setIndexSize(items.length);
      // 焦点：Modal 自身会抢一次，这里在下一帧补
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, repo, contentPaths]);

  // 输入即搜（数据全在内存，无需防抖；条目多时 useDeferredValue 缓冲输入法逐字）
  const deferredTerms = useDeferredValue(terms);
  useEffect(() => {
    if (!open) return;
    if (!deferredTerms.trim()) {
      setResults([]);
      return;
    }
    const items = collectIndexedItems(repo, contentPaths);
    setResults(searchEntries(items, deferredTerms));
  }, [deferredTerms, open, repo, contentPaths]);

  const openResult = (result: GlobalSearchResult) => {
    onClose();
    const path = result.item.path;
    const normalizedBase = draftPath || '.draft';
    const isDraft = path.startsWith(`${normalizedBase}/`);
    const basePath = isDraft ? normalizedBase : path.split('/').slice(0, -1).join('/');
    navigate(buildEditUrl({
      owner: repo.owner,
      repo: repo.repo,
      branch: repo.branch,
      basePath,
      filePath: path,
      returnTo: isDraft ? 'drafts' : basePath,
    }));
  };

  const grouped = useMemo(() => {
    const inDraft = results.filter((r) => r.item.path.startsWith(`${draftPath || '.draft'}/`));
    const inContent = results.filter((r) => !r.item.path.startsWith(`${draftPath || '.draft'}/`));
    return { inDraft, inContent };
  }, [results, draftPath]);

  if (!open) return null;

  const renderGroup = (title: string, group: GlobalSearchResult[]) => {
    if (group.length === 0) return null;
    return (
      <div className="mb-3">
        <p className="text-[11px] text-muted-foreground mb-1 px-1">{title}</p>
        <ul className="space-y-0.5">
          {group.slice(0, 8).map((r) => (
            <li key={r.item.path}>
              <button
                type="button"
                onClick={() => openResult(r)}
                className="w-full text-left px-2 py-1.5 rounded-sm hover:bg-accent transition-colors flex items-center gap-2"
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">
                  {r.item.frontmatter?.title || r.item.name}
                </span>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {r.matchedIn.join('·')}
                </span>
              </button>
            </li>
          ))}
          {group.length > 8 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">…等 {group.length} 条</li>
          )}
        </ul>
      </div>
    );
  };

  return (
    <Modal ariaLabel="全局搜索" onClose={onClose} className="bg-card rounded-md shadow-sm p-4 w-full max-w-lg mx-4 border border-border">
      <div className="flex items-center gap-2 border border-border rounded-sm px-2.5 py-2 mb-3 bg-background">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="搜索标题、标签、文件名……"
          className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          aria-label="搜索关键词"
        />
        {terms && deferredTerms !== terms && (
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
        )}
      </div>

      {terms && results.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {indexSize === 0 ? '本地暂无索引，请先访问内容库/草稿箱建立索引' : '没有匹配的文章'}
        </p>
      )}
      {!terms && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          已索引 {indexSize} 篇文章（本地缓存）。支持标题、标签、文件名匹配。
        </p>
      )}

      {renderGroup('草稿箱', grouped.inDraft)}
      {renderGroup('内容库', grouped.inContent)}
    </Modal>
  );
}
