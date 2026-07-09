// 博客框架自动识别工具

import type { Repo } from '../../../shared/types';
import { API_BASE } from './constants';

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

// 检测单个仓库的博客框架
async function detectFrameworkForRepo(
  owner: string,
  repo: string,
  defaultBranch: string = 'main'
): Promise<FrameworkInfo | null> {
  try {
    const branch = encodeURIComponent(defaultBranch);
    const response = await fetch(`${API_BASE}/api/repos/files?owner=${owner}&repo=${repo}&path=&branch=${branch}`, {
      credentials: 'include'
    });
    
    if (!response.ok) {
      return null;
    }
    
    const files = await response.json();
    const fileNames = files.map((f: { name: string }) => f.name).filter(Boolean);
    
    for (const [frameworkName, rule] of Object.entries(FRAMEWORK_RULES)) {
      // 检查根目录文件
      const rootMatch = rule.files.some(f => fileNames.includes(f));
      if (rootMatch) {
        return { name: frameworkName, color: rule.color };
      }
      
      // 检查子目录文件
      for (const path of rule.paths) {
        try {
          const checkResponse = await fetch(
            `${API_BASE}/api/repos/file?owner=${owner}&repo=${repo}&path=${encodeURIComponent(path)}&branch=${branch}`,
            { credentials: 'include' }
          );
          if (checkResponse.ok) {
            return { name: frameworkName, color: rule.color };
          }
        } catch {
          // 文件不存在，继续检查
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

// 检测仓库列表中的博客框架
export async function detectFrameworks(repos: Repo[]): Promise<DetectedRepo[]> {
  const detectedRepos = [...repos];
  
  // 只检测前 20 个仓库（避免过多 API 调用）
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
  
  // 合并检测结果
  for (const detected of results) {
    const index = detectedRepos.findIndex(r => r.full_name === detected.full_name);
    if (index !== -1) {
      detectedRepos[index] = detected;
    }
  }
  
  return detectedRepos;
}

// 导出框架配置，供其他模块使用
export const FRAMEWORK_RULES_EXPORT = FRAMEWORK_RULES;