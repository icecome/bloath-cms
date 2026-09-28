// 草稿预发布状态 hook：封装 draftPreviewStore 的 localStorage 读写
//
// 与 useBuffer 的关系：两者数据源独立（本 hook 用 localStorage，缓冲用 S3），
// 因此有无 S3 都能正常工作。
import { useCallback, useMemo, useState, useEffect } from 'react';
import { useRepo } from '../contexts/RepoContext';
import {
  readPreviewStore,
  writePreviewRecord,
  writePreviewRecords,
  removePreviewRecord,
  pruneAndPersist,
  buildPreviewRecord,
  resolvePreviewState,
  type DraftPreviewRecord,
} from '../lib/draftPreviewStore';
import type { EnhancedFileItem } from '../lib/extractFrontMatter';

export interface UseDraftPreviewsResult {
  /** 当前仓库+分支的全部预发布记录（键为草稿路径） */
  records: Record<string, DraftPreviewRecord>;
  /** 设置/更新一条预发布记录 */
  setPreview: (item: EnhancedFileItem, previewTarget: string) => void;
  /** 批量设置 */
  setPreviewBatch: (entries: ReadonlyArray<{ item: EnhancedFileItem; previewTarget: string }>) => void;
  /** 取消一条预发布 */
  cancelPreview: (path: string) => void;
  /** 按给定路径集合清理孤立记录并落盘（显式操作成功后调用） */
  pruneOrphansFor: (livePaths: ReadonlySet<string>) => void;
  /** 给草稿列表叠加预发布状态，返回新数组 */
  applyTo: (items: readonly EnhancedFileItem[]) => EnhancedFileItem[];
}

export function useDraftPreviews(): UseDraftPreviewsResult {
  const { selectedRepo } = useRepo();
  const [records, setRecords] = useState<Record<string, DraftPreviewRecord>>({});

  // 切换仓库/分支时重新读取对应的存储键。
  // localStorage 是同步的，不存在"陈旧响应覆盖"问题（与网络请求不同）。
  useEffect(() => {
    if (!selectedRepo) {
      setRecords({});
      return;
    }
    setRecords(readPreviewStore(selectedRepo).records);
  }, [selectedRepo]);

  const setPreview = useCallback((item: EnhancedFileItem, previewTarget: string) => {
    if (!selectedRepo) return;
    const store = writePreviewRecord(selectedRepo, item.path, buildPreviewRecord(item, previewTarget));
    setRecords(store.records);
  }, [selectedRepo]);

  const setPreviewBatch = useCallback(
    (entries: ReadonlyArray<{ item: EnhancedFileItem; previewTarget: string }>) => {
      if (!selectedRepo || entries.length === 0) return;
      const store = writePreviewRecords(
        selectedRepo,
        entries.map(({ item, previewTarget }) => ({
          path: item.path,
          record: buildPreviewRecord(item, previewTarget),
        }))
      );
      setRecords(store.records);
    },
    [selectedRepo]
  );

  const cancelPreview = useCallback((path: string) => {
    if (!selectedRepo) return;
    const store = removePreviewRecord(selectedRepo, path);
    setRecords(store.records);
  }, [selectedRepo]);

  const pruneOrphansFor = useCallback((livePaths: ReadonlySet<string>) => {
    if (!selectedRepo) return;
    const store = pruneAndPersist(selectedRepo, livePaths);
    setRecords(store.records);
  }, [selectedRepo]);

  // 叠加状态：不修改传入项，返回新对象（避免后续 setFiles 出现引用共享问题）。
  // 未预发布时 previewTarget 置 undefined，避免同一项在多次渲染间残留旧值。
  const applyTo = useCallback((items: readonly EnhancedFileItem[]): EnhancedFileItem[] => {
    return items.map((item) => {
      const record = records[item.path];
      const state = resolvePreviewState(record, item);
      return { ...item, previewState: state, previewTarget: record?.previewTarget };
    });
  }, [records]);

  return useMemo<UseDraftPreviewsResult>(() => ({
    records,
    setPreview,
    setPreviewBatch,
    cancelPreview,
    pruneOrphansFor,
    applyTo,
  }), [records, setPreview, setPreviewBatch, cancelPreview, pruneOrphansFor, applyTo]);
}
