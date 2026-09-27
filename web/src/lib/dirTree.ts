// 发布目标目录树：从仓库真实文件树推导以内容目录为根的可选目录
import { getTree } from './api';
import { filterValidDirs } from './path';
import type { RepoInfo } from '../../../shared/types';

export interface DirNode {
  /** 完整路径，如 content/posts/sub */
  path: string;
  /** 末段名称，如 sub */
  name: string;
  children: DirNode[];
}

interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
}

/**
 * 以 roots（内容目录）为根，构建目录树。
 * 根目录自身始终作为一个节点，即使当前为空；其余子目录来自仓库真实树。
 */
export function buildDirTree(entries: readonly TreeEntry[], rawRoots: string[]): DirNode[] {
  const roots = filterValidDirs(rawRoots);
  if (roots.length === 0) return [];

  const dirPaths = new Set<string>();
  for (const entry of entries) {
    // 文件的父目录链全部登记为可发布目录
    let p = entry.type === 'dir' ? entry.path : entry.path.split('/').slice(0, -1).join('/');
    while (p) {
      dirPaths.add(p);
      p = p.split('/').slice(0, -1).join('/');
    }
  }

  const nodeCache = new Map<string, DirNode>();
  const getNode = (path: string): DirNode => {
    let node = nodeCache.get(path);
    if (!node) {
      node = { path, name: path.split('/').pop() || path, children: [] };
      nodeCache.set(path, node);
    }
    return node;
  };

  const rootNodes = roots.map(getNode);

  // 只吸收位于某个 root 之下的目录
  for (const dir of dirPaths) {
    const ownerRoot = roots.find((r) => dir === r || dir.startsWith(r + '/'));
    if (!ownerRoot || dir === ownerRoot) continue;
    const parent = getNode(dir.split('/').slice(0, -1).join('/'));
    const node = getNode(dir);
    if (!parent.children.some((c) => c.path === node.path)) {
      parent.children.push(node);
    }
  }

  const sortChildren = (nodes: DirNode[]): DirNode[] => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const n of nodes) sortChildren(n.children);
    return nodes;
  };

  return sortChildren(rootNodes);
}

export async function fetchDirTree(repo: RepoInfo, roots: string[]): Promise<DirNode[]> {
  const entries = await getTree(repo);
  return buildDirTree(entries, roots);
}
