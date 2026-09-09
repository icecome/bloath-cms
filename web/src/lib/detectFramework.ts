// 博客框架自动识别工具

import type { Repo } from '../../../shared/types';
import { getTree } from './api';

interface FrameworkRule {
  name: string;
  /** 根目录配置文件名 */
  files: string[];
  /** 仓库内完整路径（如嵌套配置） */
  paths: string[];
  /**
   * 目录特征前缀：命中配置文件后，还需仓库内存在此前缀的文件作为佐证。
   * 用于消歧 _config.yml 归属（Hexo 与 Jekyll 根配置同名）
   */
  dirHints: string[];
  color: string;
}

/**
 * 规则按特异性排序：
 * - Hugo/Astro/Next.js/VuePress/Docusaurus 配置文件名唯一，直接命中
 * - Hexo 与 Jekyll 共用根级 _config.yml，必须依赖目录特征区分：
 *   Hexo 站必有 source/（或 themes/、scaffolds/），Jekyll 站必有 _posts/
 * - 仅有 _config.yml 而无任何特征的仓库不判定（宁可未知，不可误判）
 */
const FRAMEWORK_RULES: FrameworkRule[] = [
  {
    name: 'Hugo',
    files: ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml'],
    paths: ['config/_default/hugo.toml', 'config/hugo.toml'],
    dirHints: [],
    color: '#FF4088'
  },
  {
    name: 'Astro',
    files: ['astro.config.mjs', 'astro.config.js'],
    paths: [],
    dirHints: [],
    color: '#FF5D01'
  },
  {
    name: 'Next.js',
    files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    paths: [],
    dirHints: [],
    color: '#000000'
  },
  {
    name: 'VuePress',
    files: ['vuepress.config.js'],
    paths: ['.vuepress/config.js', '.vuepress/config.ts'],
    dirHints: [],
    color: '#4FC08D'
  },
  {
    name: 'Docusaurus',
    files: ['docusaurus.config.js', 'docusaurus.config.ts'],
    paths: [],
    dirHints: [],
    color: '#3D2555'
  },
  {
    name: 'Hexo',
    files: ['_config.yml', '_config.yaml'],
    paths: [],
    dirHints: ['source/', 'themes/', 'scaffolds/'],
    color: '#0E83CD'
  },
  {
    name: 'Jekyll',
    files: ['_config.yml', '_config.yaml'],
    paths: [],
    dirHints: ['_posts/'],
    color: '#000000'
  }
];

export interface FrameworkInfo {
  name: string;
  color: string;
}

export interface DetectedRepo extends Repo {
  framework?: FrameworkInfo;
}

export function matchFramework(treePaths: string[]): FrameworkInfo | null {
  const rootFileNames = new Set(
    treePaths.filter((p) => !p.includes('/')).map((p) => p.split('/').pop() || p)
  );

  for (const rule of FRAMEWORK_RULES) {
    const fileHit =
      rule.files.some((f) => rootFileNames.has(f)) ||
      rule.paths.some((p) => treePaths.includes(p));
    if (!fileHit) continue;

    if (rule.dirHints.length > 0) {
      const dirHit = rule.dirHints.some((prefix) =>
        treePaths.some((p) => p.startsWith(prefix))
      );
      if (!dirHit) continue;
    }

    return { name: rule.name, color: rule.color };
  }

  return null;
}

async function detectFrameworkForRepo(
  owner: string,
  repo: string,
  defaultBranch: string = 'main'
): Promise<FrameworkInfo | null> {
  try {
    const tree = await getTree({ owner, repo, branch: defaultBranch });
    return matchFramework(tree.map((f) => f.path));
  } catch {
    return null;
  }
}

// 单仓库检测（供 Profile 匹配使用），带会话级缓存避免重复拉树
const singleDetectCache = new Map<string, FrameworkInfo | null>();

export async function detectFramework(
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<FrameworkInfo | null> {
  const cacheKey = `${owner}/${repo}@${branch}`;
  if (singleDetectCache.has(cacheKey)) {
    return singleDetectCache.get(cacheKey) ?? null;
  }
  const result = await detectFrameworkForRepo(owner, repo, branch);
  singleDetectCache.set(cacheKey, result);
  return result;
}

/** 失效指定仓库的缓存结果（供"重新识别"等需要重拉 tree 的场景调用） */
export function invalidateDetectCache(owner: string, repo: string, branch: string = 'main'): void {
  singleDetectCache.delete(`${owner}/${repo}@${branch}`);
}

// 检测仓库列表中的博客框架（只检测前 20 个，避免过多 API 调用）
export async function detectFrameworks(repos: Repo[]): Promise<DetectedRepo[]> {
  const toDetect = repos.slice(0, 20);

  const results = await Promise.all(
    toDetect.map(async (repo) => {
      const framework = await detectFrameworkForRepo(
        repo.owner,
        repo.repo,
        repo.default_branch || 'main'
      );
      return {
        ...repo,
        framework: framework || undefined
      };
    })
  );

  // 用检测结果替换前 N 个，其余保持原样
  return repos.map((repo, idx) => results[idx] ?? repo);
}
