// API 配置常量
export const API_BASE = import.meta.env.VITE_API_URL || '/api';
export const PAGE_SIZE = 20;

// 媒体源命名默认值
export const DEFAULT_MEDIA_PATH = 'assets';
export const DEFAULT_BRANCH_NAME = 'assets';
export const DEFAULT_STANDALONE_BRANCH = 'main';

// 撤销操作常量
export const UNDO_STORAGE_PREFIX = 'bloath_undo';
export const UNDO_TTL_MS = 60_000;

// 文件树查询上限
export const MAX_TREE_ITEMS = 800;
