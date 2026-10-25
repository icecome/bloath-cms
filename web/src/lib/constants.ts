// VITE_API_URL 生产环境指向 Worker 域名；本地开发不设置，走 Vite 代理（/api → localhost:8787）
export const API_BASE = import.meta.env.VITE_API_URL || '';
export const PAGE_SIZE = 20;

export const DEFAULT_MEDIA_PATH = 'assets';
export const DEFAULT_BRANCH_NAME = 'assets';
export const DEFAULT_STANDALONE_BRANCH = 'main';

// 撤销存储常量已迁移到 undoConstants.ts（避免 import.meta.env 阻断 node 测试链路），
// 此处 re-export 保持既有导入点兼容。
export { UNDO_STORAGE_PREFIX, UNDO_TTL_MS } from './undoConstants';

// 旧 MAX_TREE_ITEMS=800 硬上限已移除（P0-003）：按整仓计数会误伤目标规模仓库；
// 超大仓库由 worker 侧 Trees API truncated 守卫显式报错，前端不再二次限制。
