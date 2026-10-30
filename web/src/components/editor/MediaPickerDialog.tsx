// 媒体库选择器对话框：数据通道按存储后端分流（见 hooks/useMediaLibrary），
// 本组件只负责「列表渲染 + 选择 + 回传」。
//
// 两种模式：
//   · 单选（默认）：点一张立即回传并关闭——与改造前行为一致。
//   · 多选：点选切换、Shift 区间选择、底部「插入所选」一次性回传，顺序 = 点击顺序。
//
// 回传契约是 (urls: string[])：单选可视为 N=1 的多选，避免维护两套回调。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaLibrary, type MediaKindFilter } from '../../hooks/useMediaLibrary';
import { listImageUrlFor, isVideoName } from '../../lib/mediaUtils';
import { cdnImageErrorHandler } from '../../lib/cdnFallback';
import { computeShiftRange } from '../../lib/selectionRange';
import type { MediaLibraryItem } from '../../hooks/useMediaLibrary';
import Modal from '../ui/Modal';
import { X, Loader2, AlertCircle, Play, Check, Search, Upload, ImageOff } from 'lucide-react';

/** 类型过滤：image=只列图片（默认）；video=只列视频；all=混排 */
export type MediaPickerAccept = MediaKindFilter;

interface MediaPickerDialogProps {
  open: boolean;
  onClose: () => void;
  /** 确认回调：单选模式返回 1 项；多选模式返回 N 项（N ≥ 1），顺序 = 点击顺序 */
  onPick: (urls: string[]) => void;
  /** 是否多选，默认 false */
  multiple?: boolean;
  /** 类型过滤，默认 'image'（保持既有调用点的语义） */
  accept?: MediaPickerAccept;
  /**
   * 「上传新图片」入口回调。
   * 不传则隐藏该按钮（元数据侧的 image / image-list 字段暂不提供上传，
   * 避免在表单里再叠一层上传弹窗）。正文编辑器传入。
   */
  onUploadNew?: () => void;
  /** 外部刷新信号：上传完成后调用方递增，触发媒体库重新拉取 */
  reloadSignal?: number;
  /**
   * 并行媒体仓库：要浏览的后端 id。
   * 缺省 = 默认仓库（媒体库列表与上传目标保持一致）。
   */
  backendId?: string;
}

/** 单页渲染条数：媒体库可达数百项，一次性铺满 DOM 在移动端会明显卡顿 */
const PICKER_PAGE_SIZE = 60;

export default function MediaPickerDialog({
  open,
  onClose,
  onPick,
  multiple = false,
  accept = 'image',
  onUploadNew,
  reloadSignal = 0,
  backendId,
}: MediaPickerDialogProps) {
  const { items, repoFilePaths, loading, error, isConfigured } = useMediaLibrary(accept, open, reloadSignal, backendId);

  /** 已选路径（数组保序：角标序号 = 点击顺序） */
  const [selected, setSelected] = useState<string[]>([]);
  /** 离屏可见条数（「加载更多」） */
  const [visibleCount, setVisibleCount] = useState(PICKER_PAGE_SIZE);
  /** 上一次点击条目的路径：Shift 区间选择的锚点。
   *  必须存 path 而非数组索引：筛选（nameQuery）变化后索引会指向不同条目，
   *  path 是条目的唯一标识，Shift 时在当前筛选列表中重新定位即可。 */
  const lastPathRef = useRef<string | null>(null);
  /** 文件名筛选（前端过滤，不引入新接口） */
  const [nameQuery, setNameQuery] = useState('');

  // 每次打开重置选择、分页与筛选，避免上一次的残留状态进入本次编辑
  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setVisibleCount(PICKER_PAGE_SIZE);
    lastPathRef.current = null;
    setNameQuery('');
  }, [open]);

  /** 筛选后的列表：文件名 includes 匹配（大小写不敏感），同媒体库页口径 */
  const filteredItems = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, nameQuery]);

  const confirm = useCallback(
    (urls: string[]) => {
      if (urls.length === 0) return;
      onPick(urls);
      onClose();
    },
    [onPick, onClose]
  );

  const toggleAt = useCallback((item: MediaLibraryItem) => {
    setSelected((prev) =>
      prev.includes(item.path) ? prev.filter((p) => p !== item.path) : [...prev, item.path]
    );
  }, []);

  const handleClick = useCallback(
    (item: MediaLibraryItem, shiftKey: boolean) => {
      if (!multiple) {
        confirm([item.url]);
        return;
      }

      const anchorPath = lastPathRef.current;
      const range = shiftKey ? computeShiftRange(filteredItems, anchorPath, item.path) : null;
      if (range) {
        // 区间选择：按「当前筛选列表」中的位置把 [anchor, 点击项] 并入选择（保序、去重）。
        // 锚点以 path 记录、点击时重新定位：筛选变化后索引失效也不会选错条目。
        setSelected((prev) => {
          const next = [...prev];
          for (const path of range) {
            if (!next.includes(path)) next.push(path);
          }
          return next;
        });
        // 锚点保持在原处，便于连续扩选
        return;
      }

      lastPathRef.current = item.path;
      toggleAt(item);
    },
    [multiple, confirm, filteredItems, toggleAt]
  );

  /** 确认：按选择顺序把 path 映射回 url */
  const confirmSelection = useCallback(() => {
    const urlByPath = new Map(items.map((item) => [item.path, item.url]));
    const urls: string[] = [];
    for (const path of selected) {
      const url = urlByPath.get(path);
      // 载入更多前选中的项仍在 items 中（items 只按类型过滤，不受分页影响）
      if (url) urls.push(url);
    }
    confirm(urls);
  }, [items, selected, confirm]);

  if (!open) return null;

  const visible = filteredItems.slice(0, visibleCount);
  const title = multiple ? '从媒体库选择（可多选）' : '从媒体库选择';

  return (
    <Modal
      ariaLabel={title}
      onClose={onClose}
      className="bg-card rounded-lg shadow-lg w-full max-w-3xl mx-4 max-h-[75vh] flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 筛选行：文件名搜索 + 上传入口（上传入口按调用点决定是否显示） */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle flex-shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="按文件名筛选……"
            aria-label="按文件名筛选媒体库"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-card text-foreground placeholder-muted-foreground border border-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          />
        </div>
        {onUploadNew && (
          <button
            type="button"
            onClick={onUploadNew}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-background bg-foreground rounded-sm hover:bg-foreground/90 transition-colors flex-shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            上传新图片
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!isConfigured ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            媒体源未配置，请先在设置页完成媒体库配置
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
        ) : filteredItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            {nameQuery.trim()
              ? `没有文件名包含「${nameQuery.trim()}」的${accept === 'video' ? '视频' : accept === 'image' ? '图片' : '文件'}`
              : accept === 'video' ? '媒体库中暂无视频' : accept === 'image' ? '媒体库中暂无图片' : '媒体库中暂无文件'}
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {visible.map((item) => {
              const order = selected.indexOf(item.path);
              const isSelected = order >= 0;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={(e) => handleClick(item, e.shiftKey)}
                  onDoubleClick={() => confirm([item.url])}
                  aria-pressed={multiple ? isSelected : undefined}
                  aria-label={`${item.name}${isSelected ? `，已选，第 ${order + 1} 个` : ''}`}
                  title={item.path}
                  className={`group relative aspect-square rounded-sm overflow-hidden border transition-colors ${
                    isSelected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary'
                  }`}
                >
                  {isVideoName(item.name) ? (
                    <span className="w-full h-full flex items-center justify-center bg-accent text-muted-foreground">
                      <Play className="w-6 h-6" />
                    </span>
                  ) : (
                    <>
                      <img
                        src={listImageUrlFor(item, repoFilePaths)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                        onError={(e) =>
                          // 全部候选域失败时由 onGiveUp 显示占位，避免方形缩略图区变空白
                          // （cdnImageErrorHandler 自身只负责换域重试与隐藏 img）
                          cdnImageErrorHandler(e, (img) => {
                            const holder = img.nextElementSibling;
                            if (holder instanceof HTMLElement) holder.classList.remove('invisible');
                          })
                        }
                      />
                      {/* 占位：与 img 绝对定位叠放（button 是 aspect-square，img 与占位
                          若各占一行会撑破方形布局）。默认 invisible 不抢戏；
                          img 加载成功时被完全覆盖，失败时 onGiveUp 移除 invisible 露出 */}
                      <span className="absolute inset-0 flex items-center justify-center bg-accent text-muted-foreground invisible">
                        <ImageOff className="w-6 h-6" />
                      </span>
                    </>
                  )}
                  <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-black/55 text-[10px] text-white truncate text-left">
                    {item.name}
                  </span>
                  {isSelected && (
                    <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[10px] leading-4 font-medium">
                      {order + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!loading && !error && filteredItems.length > visibleCount && (
          <div className="flex justify-center pt-3">
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PICKER_PAGE_SIZE)}
              className="px-4 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              加载更多（剩余 {filteredItems.length - visibleCount}）
            </button>
          </div>
        )}
      </div>

      {multiple && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            已选 {selected.length} 项
          </span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              清空
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmSelection}
              disabled={selected.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-foreground text-background rounded-sm hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Check className="w-3 h-3" />
              插入所选
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
