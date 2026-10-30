// Shift 区间选择的纯计算逻辑。
//
// 从 MediaPickerDialog 抽出，便于单测（组件内联逻辑无法直接测）。
//
// 【为什么必须以 path 而非数组索引为锚点】
// 弹窗支持「按文件名筛选」，筛选会改变列表长度与顺序。若锚点存的是数组索引，
// 用户流程「点选第 6 项 → 输入筛选词 → Shift 点另一项」时，索引 6 在新列表里
// 指向的是完全不同的条目，区间会选错范围。path 是条目的唯一标识，与列表位置解耦，
// 因此 Shift 时在当前筛选列表中重新定位锚点即可。
//
// 契约：
//   · 返回区间内条目的 path 列表（按列表顺序）
//   · 锚点不在当前列表中（被筛选掉）→ 返回 null，调用方退回「普通点击」语义
//   · 目标条目不在当前列表中 → 返回 null
//   · 锚点与目标相同 → 返回只含该 path 的单元素数组（不重复叠加）

/** 参与区间计算的条目最小形状：只需 path 与顺序 */
export interface RangeItem {
  path: string;
}

/**
 * 计算 Shift 区间选择覆盖的 path 列表。
 *
 * @param items     当前（已筛选、已排序）列表
 * @param anchorPath 上一次点击的条目 path（锚点）
 * @param targetPath 本次点击的条目 path（目标）
 * @returns 区间内的 path 列表；锚点或目标不在 items 中时返回 null
 */
export function computeShiftRange(
  items: readonly RangeItem[],
  anchorPath: string | null,
  targetPath: string
): string[] | null {
  if (anchorPath === null) return null;

  const anchorIndex = items.findIndex((entry) => entry.path === anchorPath);
  if (anchorIndex < 0) return null;

  const targetIndex = items.findIndex((entry) => entry.path === targetPath);
  if (targetIndex < 0) return null;

  const [from, to] =
    anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];

  return items.slice(from, to + 1).map((entry) => entry.path);
}
