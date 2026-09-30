import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { useRepo } from './RepoContext';
import { useToast } from './ToastContext';
import {
  getBufferConfig, getBufferChanges, publishBuffer,
  type BufferConfigPublic, type BufferChangeItem, type PublishResult, type PublishItem,
} from '../lib/bufferApi';
import { readPreviewStore } from '../lib/draftPreviewStore';

interface BufferState {
  config: BufferConfigPublic | null;
  configLoading: boolean;
  changes: BufferChangeItem[];
  changesCount: number;
  publishing: boolean;
  showPublishDialog: boolean;
}

interface BufferContextValue extends BufferState {
  refreshConfig: () => Promise<void>;
  refreshChanges: () => Promise<void>;
  publish: (userName?: string, items?: PublishItem[]) => Promise<PublishResult | null>;
  setShowPublishDialog: (v: boolean) => void;
}

const BufferContext = createContext<BufferContextValue | null>(null);

export function BufferProvider({ children }: { children: ReactNode }) {
  const { selectedRepo } = useRepo();
  const { addToast } = useToast();
  const [config, setConfig] = useState<BufferConfigPublic | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [changes, setChanges] = useState<BufferChangeItem[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);

  const refreshConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const cfg = await getBufferConfig();
      setConfig(cfg);
    } catch (err) {
      console.error('[buffer] 配置加载失败，本次会话将回退 GitHub 直写：', err);
      setConfig(null);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const refreshChanges = useCallback(async () => {
    if (!selectedRepo || !config?.enabled) {
      setChanges([]);
      return;
    }
    try {
      const result = await getBufferChanges({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
      });
      setChanges(result.items);
    } catch {
      setChanges([]);
    }
  }, [selectedRepo, config?.enabled]);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  useEffect(() => {
    refreshChanges();
  }, [refreshChanges]);

  const publish = useCallback(async (userName?: string, items?: PublishItem[]): Promise<PublishResult | null> => {
    if (!selectedRepo) {
      addToast({ message: '请先选择仓库', type: 'warning' });
      return null;
    }
    setPublishing(true);
    try {
      // 全量发布也带上预发布目标，与草稿箱「发布」保持同一套目标解析
      let effectiveItems = items;
      if (!effectiveItems && changes.length > 0) {
        const records = readPreviewStore(selectedRepo).records;
        effectiveItems = changes.map((c) => {
          const raw = (records[c.path]?.previewTarget || c.publishTarget || '').trim();
          return raw ? { path: c.path, publishTarget: raw } : { path: c.path };
        });
      }
      const result = await publishBuffer({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
        userName,
        items: effectiveItems,
      });
      addToast({ message: result.message, type: result.published > 0 ? 'success' : 'info' });
      await refreshChanges();
      return result;
    } catch (err) {
      addToast({ message: `发布失败：${(err as Error).message}`, type: 'error' });
      return null;
    } finally {
      setPublishing(false);
    }
  }, [selectedRepo, addToast, refreshChanges, changes]);

  const value = useMemo<BufferContextValue>(() => ({
    config,
    configLoading,
    changes,
    changesCount: changes.length,
    publishing,
    showPublishDialog,
    refreshConfig,
    refreshChanges,
    publish,
    setShowPublishDialog,
  }), [config, configLoading, changes, publishing, showPublishDialog, refreshConfig, refreshChanges, publish]);

  return <BufferContext.Provider value={value}>{children}</BufferContext.Provider>;
}

export function useBuffer(): BufferContextValue {
  const ctx = useContext(BufferContext);
  if (!ctx) throw new Error('useBuffer 必须在 BufferProvider 内部使用');
  return ctx;
}
