export interface RepoInfo {
  owner: string;
  repo: string;
  branch?: string;
}

export interface SelectedRepo extends RepoInfo {
  branch: string;
}

export interface ContentEntry {
  id: string;
  title: string;
  slug: string;
  collection: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  createdAt: string;
  updatedAt: string;
  status: 'published' | 'draft';
}

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
  default?: unknown;
  description?: string;
}

export interface User {
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}

export interface Repo {
  name: string;
  full_name: string;
  owner: string;
  repo: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

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
  lastModified?: number;
}

export interface ContentListParams {
  owner: string;
  repo: string;
  path: string;
  branch?: string;
}

// CDN 提供商
export type CdnProvider = 'jsdmirror' | 'github_raw' | 'custom';

export type DuplicateStrategy = 'skip' | 'overwrite';

export type MediaSourceType = 'standalone' | 'repo-dir' | 'image-branch';

export interface MediaConfig {
  sourceType: MediaSourceType;
  imageOwner: string;
  imageRepo: string;
  imageBranch: string;
  mediaPath: string;
  imageBranchName: string;
  cdnProvider: CdnProvider;
  customCdnTemplate: string;
  quality: number;
  renameTemplate: string;
  duplicateStrategy: DuplicateStrategy;
}

export interface ArticleFrontmatter {
  url?: string;
  title?: string;
  date?: string;
  author?: string;
  categories?: string[];
  tags?: string[];
  cover?: string;
  weight?: number;
  encrypt?: boolean;
  encryptPasswordKey?: string;
  encryptTitle?: string;
  encryptMessage?: string;
  pictures?: string[];
  video?: string[];
  link?: string;
  link_text?: string;
  customFields?: Record<string, unknown>;
}
