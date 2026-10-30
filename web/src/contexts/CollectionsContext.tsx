import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import type { MediaConfig } from '../../../shared/types';
import { parseStoredMediaConfig, DEFAULT_BACKEND_ID, backendFromLegacy } from '../lib/configSchema';
import { DEFAULT_MEDIA_PATH, DEFAULT_BRANCH_NAME } from '../lib/constants';

interface CollectionConfig {
  paths: string[];
  draftPath?: string;
  trashPath?: string;
}

const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  paths: ['content/posts'],
  draftPath: '.draft',
  trashPath: '.trash'
};

const DEFAULT_MEDIA_CONFIG: MediaConfig = {
  sourceType: 'standalone',
  imageOwner: '',
  imageRepo: '',
  imageBranch: 'main',
  mediaPath: DEFAULT_MEDIA_PATH,
  imageBranchName: DEFAULT_BRANCH_NAME,
  cdnProvider: 'jsdelivr',
  customCdnTemplate: '',
  quality: 80,
  renameTemplate: '{Y}{m}{d}{h}{i}{s}-{filename}-{str-8}-{str-5}',
  duplicateStrategy: 'skip',
  uploadMode: 'compress',
  // 并行媒体仓库：默认含一个 standalone backend（与旧 sourceType 默认值对齐）。
  // 新配置初始化 / 旧配置迁移失败回退时，backends 均可用。
  backends: [{
    id: DEFAULT_BACKEND_ID,
    kind: 'standalone',
    label: '独立图床仓库',
    enabled: true,
    owner: '',
    repo: '',
    branch: 'main',
  }],
  defaultBackendId: DEFAULT_BACKEND_ID,
};

const COLLECTION_STORAGE_KEY = 'bloath_collections_config';
const MEDIA_STORAGE_KEY = 'bloath_media_config';

const MEDIA_CONFIG_KEYS: ReadonlyArray<keyof MediaConfig> = [
  'sourceType', 'imageOwner', 'imageRepo', 'imageBranch',
  'mediaPath', 'imageBranchName', 'cdnProvider', 'customCdnTemplate',
  'quality', 'renameTemplate', 'duplicateStrategy', 'uploadMode',
  // s3 必须在此白名单内：loadMediaConfig 只保留白名单字段，
  // 漏项会导致 S3 凭据保存成功但刷新后被过滤掉（配置看起来「消失」）
  's3',
  // 并行媒体仓库（backends + defaultBackendId）：漏项会导致并行配置刷新后丢失
  'backends', 'defaultBackendId',
];

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
      // 旧版存储可能含 label 字段：读取时剥掉，避免类型漂移（审计已判定零消费，P2 裁剪）
      const { label: _legacyLabel, ...rest } = parsed ?? {};
      return { ...DEFAULT_COLLECTION_CONFIG, ...rest };
    }
  } catch (err) {
    console.error('Failed to load collections config', err);
  }
  return DEFAULT_COLLECTION_CONFIG;
}

function loadMediaConfig(): MediaConfig {
  try {
    const stored = localStorage.getItem(MEDIA_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      // 仅保留已知字段，过滤已废弃或残留字段
      const filtered: Record<string, unknown> = {};
      for (const key of MEDIA_CONFIG_KEYS) {
        if (key in parsed) {
          filtered[key] = parsed[key];
        }
      }
      // 旧配置迁移：存量 localStorage 无 backends 字段（并行媒体仓库上线前），
      // 由 sourceType + 扁平字段构造单个 backend 写入 backends。
      // 必须在与默认值合并**之前**判定，否则默认值里的 backends 会覆盖迁移结果。
      const hasBackends = Array.isArray(filtered.backends) && filtered.backends.length > 0;
      if (!hasBackends && typeof filtered.sourceType === 'string') {
        filtered.backends = [backendFromLegacy({
          sourceType: filtered.sourceType as MediaConfig['sourceType'],
          imageOwner: String(filtered.imageOwner ?? ''),
          imageRepo: String(filtered.imageRepo ?? ''),
          imageBranch: String(filtered.imageBranch ?? 'main'),
          mediaPath: String(filtered.mediaPath ?? DEFAULT_MEDIA_PATH),
          imageBranchName: String(filtered.imageBranchName ?? DEFAULT_BRANCH_NAME),
          s3: filtered.s3 as MediaConfig['s3'],
        })];
        filtered.defaultBackendId = DEFAULT_BACKEND_ID;
      }
      const candidate = { ...DEFAULT_MEDIA_CONFIG, ...filtered } as MediaConfig;
      // Zod 结构校验（P3-5）：类型漂移（如 quality 存成字符串）时拒绝并回退默认值，
      // 与 worker 侧 parseStoredConfig 同语义；校验失败留日志便于定位脏数据
      const validated = parseStoredMediaConfig(candidate);
      if (!validated) {
        console.warn('[collections] media 配置结构非法，已回退默认值：', candidate);
        return DEFAULT_MEDIA_CONFIG;
      }
      return validated;
    }
  } catch (err) {
    console.error('Failed to load media config', err);
  }
  return DEFAULT_MEDIA_CONFIG;
}

function saveCollectionConfig(config: CollectionConfig): void {
  try {
    localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save collections config', err);
  }
}

function saveMediaConfig(config: MediaConfig): void {
  try {
    localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save media config', err);
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

  const updateConfig = useCallback((updates: Partial<CollectionConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const addPath = useCallback((path: string) => {
    const trimmedPath = path.trim();
    setConfig((prev) => {
      if (prev.paths.includes(trimmedPath)) return prev;
      return { ...prev, paths: [...prev.paths, trimmedPath] };
    });
  }, []);

  const removePath = useCallback((path: string) => {
    setConfig((prev) => {
      if (prev.paths.length <= 1) return prev;
      return { ...prev, paths: prev.paths.filter((p) => p !== path) };
    });
  }, []);

  const updateMediaConfig = useCallback((updates: Partial<MediaConfig>) => {
    setMediaConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  // value 用 useMemo 包装：updateConfig/updateMediaConfig 被 MainLayout 的
  // 配置同步 effect 依赖，引用不稳定会让该 effect 每次渲染都重跑
  const value = useMemo<CollectionsContextType>(() => ({
    config, updateConfig, addPath, removePath, mediaConfig, updateMediaConfig,
  }), [config, updateConfig, addPath, removePath, mediaConfig, updateMediaConfig]);

  return (
    <CollectionsContext.Provider value={value}>
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
