// 文章提交历史侧栏面板（P3-1）：展示当前编辑文件最近 30 次提交，
// 点击条目在 GitHub 上查看该版本。数据经 /api/repos/commits（worker 代理）。
import { useEffect, useState } from 'react';
import { History, ExternalLink, Loader2 } from 'lucide-react';
import type { RepoInfo } from '../../../../shared/types';
import { listFileCommits, type FileCommitInfo } from '../../lib/api';

interface HistoryPanelProps {
  repo: RepoInfo;
  /** 当前编辑文件的完整路径 */
  filePath: string;
  /** 面板可见时才拉取（EditorPage 侧栏切换控制） */
  active: boolean;
}

function formatCommitDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const Y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${Y}-${m}-${day} ${h}:${min}`;
}

export function HistoryPanel({ repo, filePath, active }: HistoryPanelProps) {
  const [commits, setCommits] = useState<FileCommitInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active || !filePath) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    listFileCommits({ ...repo, path: filePath })
      .then((list) => {
        if (!cancelled) setCommits(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '历史加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, filePath, repo]);

  if (!active) return null;

  return (
    <div className="p-3">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-2">
        <History className="w-3.5 h-3.5" />
        提交历史
      </h4>

      {loading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          加载历史……
        </p>
      )}

      {!loading && error && (
        <p className="text-xs text-destructive py-2">{error}</p>
      )}

      {!loading && !error && commits.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">暂无提交记录</p>
      )}

      <ul className="space-y-1">
        {commits.map((c) => (
          <li key={c.sha}>
            <a
              href={c.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-2 py-1.5 rounded-sm hover:bg-accent transition-colors"
              title={`${c.message}\n${c.author} · ${formatCommitDate(c.date)}`}
            >
              <span className="flex items-center gap-1">
                <span className="text-xs text-foreground truncate flex-1">{c.message}</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">
                {c.author || '未知'} · {formatCommitDate(c.date)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
