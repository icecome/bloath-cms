import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { MediaConfig } from '../../../shared/types';

interface CollectionConfig {
  paths: string[];
  label: string;
  draftPath?: string;
  trashPath?: string;
}

const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  paths: ['content/posts'],
  label: '文章',
  draftPath: '.draft',
  trashPath: '.trash'
};

const DEFAULT_MEDIA_CONFIG: MediaConfig = {
  imageOwner: '',
  imageRepo: '',
  cdnProvider: 'jsdelivr',
  customCdnTemplate: '',
  quality: 80,
  renameTemplate: '{Y}{m}{d}{h}{i}{s}{str-4}',
  duplicateStrategy: 'skip'
};

const COLLECTION_STORAGE_KEY = 'bloath_collections_config';
const MEDIA_STORAGE_KEY = 'bloath_media_config';

function loadCollectionConfig(): CollectionConfig {
  try {
    const stored = localStorage.getItem(COLLECTION_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && !parsed.paths && parsed.path) {
        return { ...DEFAULT_COLLECTION_CONFIG, paths: [parsed.path] };
      }
      if (parsed && !Array.isArray(parsed.paths)) {
        return { ...DEFAULT_COLLECTION_CONFIG, paths: parsed.paths ? [parsed.paths] : DEFAULT_COLLECTION_CONFIG.paths };
      }
      return { ...DEFAULT_COLLECTION_CONFIG, ...parsed };
    }
  } catch {
    console.error('Failed to load collections config');
  }
  return DEFAULT_COLLECTION_CONFIG;
}

function loadMediaConfig(): MediaConfig {
  try {
    const stored = localStorage.getItem(MEDIA_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_MEDIA_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    console.error('Failed to load media config');
  }
  return DEFAULT_MEDIA_CONFIG;
}

function saveCollectionConfig(config: CollectionConfig): void {
  try {
    localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.error('Failed to save collections config');
  }
}

function saveMediaConfig(config: MediaConfig): void {
  try {
    localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.error('Failed to save media config');
  }
}

interface CollectionsContextType {
  config: CollectionConfig;
  updateConfig: (updates: Partial<CollectionConfig>) => void;
  addPath: (path: string) => void;
  removePath: (path: string) => void;
  mediaConfig: MediaConfig;
  updateMediaConfig: (updates: Partial<MediaConfig>) => void;
}

const CollectionsContext = createContext<CollectionsContextType | undefined>(undefined);

export function CollectionsProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<CollectionConfig>(loadCollectionConfig);
  const [mediaConfig, setMediaConfig] = useState<MediaConfig>(loadMediaConfig);

  useEffect(() => {
    saveCollectionConfig(config);
  }, [config]);

  useEffect(() => {
    saveMediaConfig(mediaConfig);
  }, [mediaConfig]);

  const updateConfig = (updates: Partial<CollectionConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const addPath = (path: string) => {
    const trimmedPath = path.trim();
    setConfig((prev) => {
      if (prev.paths.includes(trimmedPath)) return prev;
      return { ...prev, paths: [...prev.paths, trimmedPath] };
    });
  };

  const removePath = (path: string) => {
    setConfig((prev) => {
      if (prev.paths.length <= 1) return prev;
      return { ...prev, paths: prev.paths.filter((p) => p !== path) };
    });
  };

  const updateMediaConfig = (updates: Partial<MediaConfig>) => {
    setMediaConfig((prev) => ({ ...prev, ...updates }));
  };

  return (
    <CollectionsContext.Provider value={{ config, updateConfig, addPath, removePath, mediaConfig, updateMediaConfig }}>
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
