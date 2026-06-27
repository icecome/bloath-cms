import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface CollectionConfig {
  paths: string[];
  label: string;
  draftPath?: string;
  trashPath?: string;
}

const DEFAULT_CONFIG: CollectionConfig = {
  paths: ['content/posts'],
  label: '文章',
  draftPath: '.draft',
  trashPath: '.trash'
};

const CONFIG_STORAGE_KEY = 'bloath_collections_config';

function loadConfig(): CollectionConfig {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // 兼容旧格式：如果是 { path: 'xxx' } 转为 { paths: ['xxx'] }
      if (parsed && !parsed.paths && parsed.path) {
        return { ...DEFAULT_CONFIG, paths: [parsed.path] };
      }
      // 确保 paths 是数组
      if (parsed && !Array.isArray(parsed.paths)) {
        return { ...DEFAULT_CONFIG, paths: parsed.paths ? [parsed.paths] : DEFAULT_CONFIG.paths };
      }
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    console.error('Failed to load collections config');
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config: CollectionConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.error('Failed to save collections config');
  }
}

interface CollectionsContextType {
  config: CollectionConfig;
  updateConfig: (updates: Partial<CollectionConfig>) => void;
  addPath: (path: string) => void;
  removePath: (path: string) => void;
}

const CollectionsContext = createContext<CollectionsContextType | undefined>(undefined);

export function CollectionsProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<CollectionConfig>(loadConfig);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const updateConfig = (updates: Partial<CollectionConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const addPath = (path: string) => {
    setConfig((prev) => {
      if (prev.paths.includes(path)) return prev;
      return { ...prev, paths: [...prev.paths, path] };
    });
  };

  const removePath = (path: string) => {
    setConfig((prev) => {
      if (prev.paths.length <= 1) return prev;
      return { ...prev, paths: prev.paths.filter((p) => p !== path) };
    });
  };

  return (
    <CollectionsContext.Provider value={{ config, updateConfig, addPath, removePath }}>
      {children}
    </CollectionsContext.Provider>
  );
}

export function useCollections() {
  const context = useContext(CollectionsContext);
  if (context === undefined) {
    throw new Error('useCollections must be used within a CollectionsProvider');
  }
  return context;
}
