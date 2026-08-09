// 博客框架自动识别工具

import type { Repo } from '../../../shared/types';
import { getTree } from './api';

// 博客框架配置文件检测规则
const FRAMEWORK_RULES = {
  'Hugo': {
    files: ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml'],
    paths: ['config/_default/hugo.toml', 'config/hugo.toml'],
    color: '#FF4088'
  },
  'Jekyll': {
    files: ['_config.yml', 'Gemfile', 'jekyll/_config.yml'],
    paths: [],
    color: '#000000'
  },
  'Astro': {
    files: ['astro.config.mjs', 'astro.config.js'],
    paths: [],
    color: '#FF5D01'
  },
  'Next.js': {
    files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    paths: [],
    color: '#000000'
  },
  'Hexo': {
    files: ['_config.yml', '_config.yaml'],
    paths: [],
    color: '#0E83CD'
  },
  'VuePress': {
    files: ['vuepress.config.js', '.vuepress/config.js'],
    paths: [],
    color: '#4FC08D'
  },
  'Docusaurus': {
    files: ['docusaurus.config.js', 'docusaurus.config.ts'],
    paths: [],
    color: '#3D2555'
  }
};

export interface FrameworkInfo {
  name: string;
  color: string;
}

export interface DetectedRepo extends Repo {
  framework?: FrameworkInfo;
}

async function detectFrameworkForRepo(
  owner: string,
  repo: string,
  defaultBranch: string = 'main'
): Promise<FrameworkInfo | null> {
  try {
    const tree = await getTree({ owner, repo, branch: defaultBranch });

    const allPaths = new Set(tree.map(f => f.path));
    const rootFileNames = new Set(
      tree.filter(f => !f.path.includes('/')).map(f => f.name)
    );

    for (const [frameworkName, rule] of Object.entries(FRAMEWORK_RULES)) {
      if (rule.files.some(f => rootFileNames.has(f))) {
        return { name: frameworkName, color: rule.color };
      }

      if (rule.paths.some(p => allPaths.has(p))) {
        return { name: frameworkName, color: rule.color };
      }
    }

    return null;
  } catch {
    return null;
  }
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
