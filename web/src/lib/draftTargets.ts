// 草稿发布目标构造（零依赖纯函数，可进 node --test 链路）。
//
// 【为什么从 DraftsPage.tsx 抽出】DraftsPage 是 1116 行的编排单元，12 个 useState
// 与发布/移动/删除三条写路径混在一起，无任何测试覆盖——AGENTS.md §9 记的
// 「sortFiles 静默失效 7 周」就是同一形态：逻辑藏在页面里，编译与单测都发现不了。
// 抽出后可按 AGENTS.md §4 铁律 3 配同目录 .test.ts。
//
// 【不能依赖 React】任何 import 到 react / 组件的模块都无法进入
// `node --experimental-strip-types` 测试链路（AGENTS.md §9 的 ERR_MODULE_NOT_FOUND 坑）。
// 本模块只允许类型导入。
import type { EnhancedFileItem } from './extractFrontMatter.ts';

/** 单条已确定目标的草稿：item 为源文件，previewTarget 为拟发布的目标路径 */
export interface DraftTargetEntry {
  item: EnhancedFileItem;
  previewTarget: string;
}

/**
 * 由草稿项与「path → 目标路径」映射表构造待持久化条目。
 *
 * 三条已发生过的失败路径，均由本模块与测试锁死：
 * 1. 目标为空/纯空白的条目必须剔除——它们既不该进发布批次，也不该进预发布状态，
 *    否则发布对话框会显示一行没有目标的草稿。
 * 2. path 相同而目标不同的重复项必须去重（后写覆盖先写），否则同一源文件会被
 *    commit 两次，第二次因源文件已不存在而报错（双击提交的实际形态）。
 * 3. 目标路径两端空白必须裁掉：用户在输入框里粘贴带空格的目标是常见操作。
 *
 * @param items   当前页选中的草稿项
 * @param targets path → 用户输入的目标路径（可能为 '' 或含空白）
 */
export function buildTargetEntries(
  items: ReadonlyArray<EnhancedFileItem>,
  targets: Record<string, string>
): DraftTargetEntry[] {
  const byPath = new Map<string, DraftTargetEntry>();

  for (const item of items) {
    const target = (targets[item.path] || '').trim();
    if (!target) continue;
    // 后出现的覆盖先出现的：与「用户改了目标再确认」的直觉一致
    byPath.set(item.path, { item, previewTarget: target });
  }

  return [...byPath.values()];
}

/**
 * 判断一批条目里是否存在「多个源文件指向同一目标」。
 * 冲突时发布会互相覆盖（后提交的赢），必须在点确认前拦住并提示用户。
 *
 * @returns 目标路径 → 冲突的源路径列表；无冲突返回空数组
 */
export function findTargetConflicts(entries: ReadonlyArray<DraftTargetEntry>): Array<{
  target: string;
  sources: string[];
}> {
  const byTarget = new Map<string, string[]>();

  for (const entry of entries) {
    const list = byTarget.get(entry.previewTarget);
    if (list) list.push(entry.item.path);
    else byTarget.set(entry.previewTarget, [entry.item.path]);
  }

  const conflicts: Array<{ target: string; sources: string[] }> = [];
  for (const [target, sources] of byTarget) {
    if (sources.length > 1) conflicts.push({ target, sources });
  }
  return conflicts;
}

/**
 * 把冲突列表压成一句用户可见提示；无冲突返回 null。
 *
 * 抽到这里的两个原因：
 * 1. 三处写路径（预发布 / 单键发布 / 高级流）需要完全一致的文案，复制粘贴会漂移；
 * 2. 调用点需在 `noUncheckedIndexedAccess` 下安全取第一条，索引取值逻辑集中一处即可。
 */
export function describeTargetConflict(
  conflicts: ReadonlyArray<{ target: string; sources: string[] }>
): string | null {
  const first = conflicts[0];
  if (!first) return null;
  const suffix = conflicts.length > 1 ? `，另有 ${conflicts.length - 1} 组重复` : '';
  return `目标重复：${first.target}（${first.sources.length} 篇草稿）${suffix}。请为每篇草稿指定不同目标。`;
}
