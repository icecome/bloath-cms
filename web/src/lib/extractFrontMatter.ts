import fm from 'front-matter';
import { readFile } from './api';
import type { ArticleFrontmatter, RepoInfo } from '../../../shared/types';

/**
 * 从 Front Matter 提取的增强文件项
 */
export interface EnhancedFileItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
  lastModified?: number;
  /** Front Matter 元数据 */
  frontmatter?: ArticleFrontmatter;
  /** 解析后的排序日期时间戳 */
  sortDate?: number;
}

export interface ExtractOptions {
  /** 并发批次大小，默认 5 */
  batchSize?: number;
  /** 单文件读取超时，默认 8000ms */
  timeoutMs?: number;
  /** 最大重试次数，默认 2 */
  maxRetries?: number;
}

const DEFAULT_OPTIONS: Required<ExtractOptions> = {
  batchSize: 5,
  timeoutMs: 8000,
  maxRetries: 2,
};

/**
 * 将 Front Matter date 字段转换为时间戳
 * 支持格式：
 * - Date 对象: front-matter 库会将 ISO 8601 日期解析为 Date 对象
 * - ISO 8601 字符串: "2026-07-07T12:00:00+08:00"
 * - 日期字符串: "2026-07-07"
 * - 完整日期: "Fri Mar 07 2025 18:00:00 GMT+0800"
 * - 时间戳: 1688774400000
 */
export function parseDateToTimestamp(dateValue?: string | number | Date): number {
  if (!dateValue) return 0;

  if (dateValue instanceof Date) return dateValue.getTime();

  if (typeof dateValue === 'number') return dateValue;

  if (typeof dateValue === 'string') {
    const ts = new Date(dateValue).getTime();
    if (!isNaN(ts)) return ts;

    const dateMatch = dateValue.match(/(\d{4})[-/年](\d{1,2})[-/月]?(\d{1,2})?[\s日]?/);
    if (dateMatch) {
      const year = parseInt(dateMatch[1] ?? '', 10);
      const month = parseInt(dateMatch[2] ?? '', 10) - 1;
      if (isNaN(year) || isNaN(month)) return 0;
      const day = dateMatch[3] ? parseInt(dateMatch[3], 10) : 1;
      const fallbackTs = new Date(year, month, day).getTime();
      if (!isNaN(fallbackTs)) return fallbackTs;
    }

    const compactMatch = dateValue.match(/(\d{8})/);
    if (compactMatch) {
      const num = parseInt(compactMatch[1] ?? '', 10);
      if (isNaN(num)) return 0;
      const year = Math.floor(num / 10000);
      const month = Math.floor((num % 10000) / 100) - 1;
      const day = num % 100;
      const fallbackTs = new Date(year, month, day).getTime();
      if (!isNaN(fallbackTs)) return fallbackTs;
    }
  }

  return 0;
}

/**
 * 读取单个 Markdown 文件并提取 Front Matter
 */
async function readSingleFrontmatter(
  file: EnhancedFileItem,
  repoInfo: RepoInfo,
  options: Required<ExtractOptions>,
  retries: number = 0
): Promise<EnhancedFileItem> {
  try {
    const { content } = await readFile({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      path: file.path,
      branch: repoInfo.branch || 'main',
    }, options.timeoutMs);

    const header = content.slice(0, 1024);

    const result = fm<ArticleFrontmatter>(header);
    const attributes = result.attributes || {};

    if (import.meta.env.DEV) {
      console.log(`[extractFrontMatter] ${file.name}: date=${attributes.date}, sortDate=${parseDateToTimestamp(attributes.date)}`);
    }

    return {
      ...file,
      frontmatter: attributes,
      sortDate: parseDateToTimestamp(attributes.date),
    };
  } catch (err) {
    console.error(`[extractFrontMatter] 读取 ${file.name} 失败:`, err);
    if (retries < options.maxRetries) {
      await delay(500 * (retries + 1));
      return readSingleFrontmatter(file, repoInfo, options, retries + 1);
    }
    return file;
  }
}

/**
 * 分批并发读取 Front Matter
 */
async function batchFetch(
  files: EnhancedFileItem[],
  repoInfo: RepoInfo,
  options: Required<ExtractOptions>
): Promise<EnhancedFileItem[]> {
  const results = [...files];

  for (let i = 0; i < results.length; i += options.batchSize) {
    const batch = results.slice(i, i + options.batchSize);
    const batchResults = await Promise.all(
      batch.map((file) => readSingleFrontmatter(file, repoInfo, options))
    );
    batchResults.forEach((result, idx) => {
      results[i + idx] = result;
    });
  }

  return results;
}

/**
 * 从文件路径列表并发提取 Front Matter 元数据
 */
export async function extractFrontMatters(
  files: EnhancedFileItem[],
  repoInfo: RepoInfo,
  options?: ExtractOptions
): Promise<EnhancedFileItem[]> {
  if (files.length === 0) return [];

  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const result = await batchFetch(files, repoInfo, resolvedOptions);
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
