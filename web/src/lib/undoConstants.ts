// 撤销存储常量：与 constants.ts 的 UNDO_STORAGE_PREFIX / UNDO_TTL_MS 保持一致。
// 独立文件的原因：constants.ts 读取 import.meta.env（Vite 专属），无法进入
// node --experimental-strip-types 测试链路；本文件零环境依赖。
export const UNDO_STORAGE_PREFIX = 'bloath_undo';
export const UNDO_TTL_MS = 60_000;
