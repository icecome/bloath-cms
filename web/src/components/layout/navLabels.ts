// 导航标签与路径映射（纯常量 + 纯函数，零 React 依赖）。
//
// 【为什么独立成文件】侧栏与顶栏面包屑共用同一份映射。把它们放在
// SidebarContent.tsx 里会让该组件文件同时导出组件与非组件值，触发
// react-refresh/only-export-components（Fast Refresh 下这类模块的改动
// 会整块重载而不是热替换）。独立后 SidebarContent 只导出组件。

/** 路由 → 可见标题。'/' 单独处理：它是内容库，且需要精确匹配 */
export const NAV_ITEM_LABELS: Record<string, string> = {
  '/': '内容库',
  '/drafts': '草稿箱',
  '/trash': '回收站',
  '/media': '媒体库',
  '/settings': '设置',
};

/**
 * 取当前路径对应的面包屑标题。
 *
 * 未匹配到已知路由时返回空串——调用方据此隐藏该段。旧实现回退成类目词「CMS」，
 * 在面包屑里零信息量（用户已经在用 CMS 了），而且会让「Bloath / CMS」看起来
 * 像两条并列的层级。
 */
export function getCurrentNavLabel(pathname: string): string {
  const match = Object.keys(NAV_ITEM_LABELS).find((p) => {
    if (p === '/') return pathname === '/';
    return pathname.startsWith(p);
  });
  return match ? (NAV_ITEM_LABELS[match] ?? '') : '';
}
