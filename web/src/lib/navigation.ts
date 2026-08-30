/**
 * 编辑器跳转 URL 构建工具
 * slug 仅用于 URL 展示，实际加载依赖 filePath 参数（相对 basePath，不含 .md）
 */
interface EditUrlParams {
  owner: string;
  repo: string;
  branch: string;
  /** 内容路径，如 content/posts */
  basePath: string;
  /** 相对 basePath 的文件路径，不含 .md */
  filePath: string;
  /** 返回目标：'drafts' 或具体路径 */
  returnTo?: string;
}

export function buildEditUrl({
  owner,
  repo,
  branch,
  basePath,
  filePath,
  returnTo,
}: EditUrlParams): string {
  const originalRelative = filePath.replace(/\.md$/, '');
  const slug = originalRelative.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  const params = new URLSearchParams({
    owner,
    repo,
    branch,
    basePath,
    filePath: originalRelative,
  });
  if (returnTo) {
    params.set('returnTo', returnTo);
  }
  return `/editor/${slug}?${params.toString()}`;
}
