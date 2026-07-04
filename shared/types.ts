// 内容条目
export interface ContentEntry {
  id: string;
  title: string;
  slug: string;
  collection: string;
  path: string;
  frontmatter: Record<string, any>;
  body: string;
  createdAt: string;
  updatedAt: string;
  status: 'published' | 'draft';
}

// 内容集合
export interface Collection {
  name: string;
  label: string;
  description?: string;
  path: string;
  fileExtension: 'md' | 'mdx';
  filenamePattern?: string;
  fields: FieldConfig[];
}

// 字段配置
export interface FieldConfig {
  name: string;
  label: string;
  type: 'string' | 'text' | 'rich-text' | 'boolean' | 'number'
      | 'datetime' | 'select' | 'multiselect' | 'image' | 'url' | 'slug';
  required?: boolean;
  options?: string[];
  default?: any;
  description?: string;
}

// 用户信息
export interface User {
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}

// GitHub仓库
export interface Repo {
  name: string;
  full_name: string;
  owner: string;
  repo: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

// API响应
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// 文件信息
export interface FileInfo {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  size?: number;
}

// 内容列表请求
export interface ContentListParams {
  owner: string;
  repo: string;
  path: string;
  branch?: string;
}

// CDN 提供商
export type CdnProvider = 'jsdelivr' | 'github_raw' | 'custom';

// 同名文件策略
export type DuplicateStrategy = 'skip' | 'overwrite';

// 媒体库配置
export interface MediaConfig {
  imageOwner: string;
  imageRepo: string;
  cdnProvider: CdnProvider;
  customCdnTemplate: string;
  quality: number;
  renameTemplate: string;
  duplicateStrategy: DuplicateStrategy;
}
