import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { useRepo } from './RepoContext';
import { useToast } from './ToastContext';
import {
  getBufferConfig, getBufferChanges, publishBuffer,
  type BufferConfigPublic, type BufferChangeItem, type PublishResult,
} from '../lib/bufferApi';

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
  publish: (userName?: string) => Promise<PublishResult | null>;
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
    } catch {
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

  const publish = useCallback(async (userName?: string): Promise<PublishResult | null> => {
    if (!selectedRepo) {
      addToast({ message: '请先选择仓库', type: 'warning' });
      return null;
    }
    setPublishing(true);
    try {
      const result = await publishBuffer({
        owner: selectedRepo.owner,
        repo: selectedRepo.repo,
        branch: selectedRepo.branch,
        userName,
      });
      addToast({ message: result.message, type: result.published > 0 ? 'success' : 'info' });
      await refreshChanges();
      return result;
    } catch (err) {
      addToast({ message: `发布失败: ${(err as Error).message}`, type: 'error' });
      return null;
    } finally {
      setPublishing(false);
    }
  }, [selectedRepo, addToast, refreshChanges]);

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
