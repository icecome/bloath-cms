// VITE_API_URL 生产环境指向 Worker 域名；本地开发不设置，走 Vite 代理（/api → localhost:8787）
export const API_BASE = import.meta.env.VITE_API_URL || '';
export const PAGE_SIZE = 20;

export const DEFAULT_MEDIA_PATH = 'assets';
export const DEFAULT_BRANCH_NAME = 'assets';
export const DEFAULT_STANDALONE_BRANCH = 'main';

export const UNDO_STORAGE_PREFIX = 'bloath_undo';
export const UNDO_TTL_MS = 60_000;

export const MAX_TREE_ITEMS = 800;
