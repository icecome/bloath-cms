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

// 字段分组（schema 驱动表单按组折叠展示）
export type FieldGroup = 'basic' | 'advanced' | 'special' | 'seo' | 'custom';

// 字段条件显示：依赖另一字段值，不满足则隐藏（值保留）。
// equals 限定布尔：依赖字段未定义/未开启统一按 false 处理（见 isFieldVisible），
// 不开放字符串/假值分支以免产生「未定义字段该匹配何值」的歧义。
export interface ShowWhen {
  field: string;
  equals: boolean;
}

// 字段配置
export interface FieldConfig {
  name: string;
  label: string;
  type: 'string' | 'text' | 'rich-text' | 'boolean' | 'number'
      | 'datetime' | 'select' | 'multiselect' | 'image' | 'url' | 'slug'
      | 'image-list' | 'string-list' | 'custom-fields';
  required?: boolean;
  options?: string[];
  default?: unknown;
  description?: string;
  placeholder?: string;
  group?: FieldGroup;
  /** 满足条件才显示；不满足时字段在前端隐藏但已存值保留 */
  showWhen?: ShowWhen;
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
  /** 表单内 URL 字段：解耦模式下映射为 front-matter slug */
  url?: string;
  /** Hugo 等框架的 front-matter slug（URL 最后一段） */
  slug?: string;
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

// 批量提交的单条变更指令（后端 Git Data API 与前端构造共用）
export interface CommitOp {
  /** write=写入内容；move=仓库内移动（免内容上传，复用 blob）；delete=删除 */
  op: 'write' | 'move' | 'delete';
  /** write/move 的目标路径，delete 的待删路径 */
  path: string;
  /** move 的源路径 */
  fromPath?: string;
  /** write 的文本内容 */
  content?: string;
  /** write 的 base64 内容（图片等二进制） */
  base64Content?: string;
}

// front-matter 定界正则：--- → YAML，+++ → TOML（前后端共用，解析规则保持一致）
export const FRONTMATTER_YAML_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;
export const FRONTMATTER_TOML_REGEX = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+/;

// ---------- 留言模块（前后端共用）----------
//
// 此前 MessageRow（worker）与 AdminMessage（web）各自定义了一遍同一张表的行结构，
// 字段漂移需两处同步修改。此处下沉为单一真源，两侧用 Pick/Omit 派生各自视图。

export type MessageStatus = 'pending' | 'approved' | 'featured' | 'spam';

/** replies 表行结构 */
export interface MessageReplyRow {
  id: number;
  message_id: number;
  reply_content: string;
  reply_type: '博主' | '邮箱回信';
  reply_from_email: string;
  created_at: string;
}

/** messages 表完整行结构（含仅后端可见的字段） */
export interface MessageRecord {
  id: number;
  visitor_name: string;
  visitor_email: string;
  visitor_website: string;
  visitor_ip: string;
  user_agent: string;
  client_hash: string;
  content: string;
  quoted_text: string;
  page_url: string;
  page_title: string;
  status: MessageStatus;
  is_deleted: number;
  needs_review: number;
  reply_content: string;
  reply_at: string | null;
  reply_token: string;
  created_at: string;
  updated_at: string;
}

/** 管理面返回给前端的留言视图：剔除仅服务端使用的字段，附带回复列表 */
export type MessageAdminView = Omit<MessageRecord, 'user_agent' | 'client_hash' | 'reply_token'> & {
  replies: MessageReplyRow[];
};
