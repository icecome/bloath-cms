// 撤销存储常量：与 constants.ts 的 UNDO_STORAGE_PREFIX / UNDO_TTL_MS 保持一致。
// 独立文件的原因：constants.ts 读取 import.meta.env（Vite 专属），无法进入
// node --experimental-strip-types 测试链路；本文件零环境依赖。
export const UNDO_STORAGE_PREFIX = 'bloath_undo';
// P1-003：60s 太短——用户常在删除后继续浏览，回来时撤销已失效只能去 .trash 捞。
// 10 分钟覆盖一次自然的「删错 → 继续干活 → 想起来」周期。
export const UNDO_TTL_MS = 600_000;
