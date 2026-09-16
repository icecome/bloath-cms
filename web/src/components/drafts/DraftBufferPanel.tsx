import { useNavigate } from 'react-router-dom';
import { FilePen } from 'lucide-react';
import type { BufferChangeItem } from '../../lib/bufferApi';
import { buildEditUrl } from '../../lib/navigation';

interface Props {
  draftPath: string;
  items: BufferChangeItem[];
  selectedRepo: { owner: string; repo: string; branch: string } | null;
}

export function DraftBufferPanel({ draftPath, items, selectedRepo }: Props) {
  const navigate = useNavigate();
  const draftBufferItems = items.filter((c) => c.path.startsWith(draftPath + '/') && c.op === 'write');
  if (draftBufferItems.length === 0) return null;

  return (
    <div className="mt-3 border border-border rounded-sm bg-accent/40">
      <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
        <FilePen className="w-3 h-3" />
        缓冲中的草稿（{draftBufferItems.length} 篇，未发布到仓库）
      </div>
      <div className="divide-y divide-border-subtle">
        {draftBufferItems.map((item) => {
          const name = item.path.split('/').pop() || item.path;
          const relative = item.path.replace(draftPath + '/', '');
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => {
                if (!selectedRepo) return;
                navigate(buildEditUrl({
                  owner: selectedRepo.owner,
                  repo: selectedRepo.repo,
                  branch: selectedRepo.branch,
                  basePath: draftPath,
                  filePath: relative,
                  returnTo: 'drafts',
                }));
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
            >
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 rounded-sm flex-shrink-0">未发布</span>
              <span className="text-sm text-foreground truncate flex-1">{name}</span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                {new Date(item.savedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
