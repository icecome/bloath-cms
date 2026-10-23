export interface RepoInfo {
  owner: string;
  repo: string;
  branch?: string;
}

export interface SelectedRepo extends RepoInfo {
  branch: string;
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
  /** 正则校验（string/url/slug 类字段）；完整匹配语义由 SchemaFormPanel 实现 */
  pattern?: string;
  /** pattern 校验失败时的提示文案（缺省用通用文案） */
  patternMessage?: string;
  /** number 数值下限（含） */
  min?: number;
  /** number 数值上限（含） */
  max?: number;
  /** 文本最大长度（string/text/url/slug）；超出禁止输入并提示 */
  maxLength?: number;
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

// CDN 提供商
export type CdnProvider = 'jsdmirror' | 'github_raw' | 'custom';

export type DuplicateStrategy = 'skip' | 'overwrite';

/** 图片上传方式：compress=重编码为 WebP（默认）；original=保留原始格式与字节 */
export type UploadMode = 'compress' | 'original';

export type MediaSourceType = 'standalone' | 'repo-dir' | 'image-branch' | 's3';

/** S3 兼容图床的连接配置（sourceType = 's3' 时生效；凭据仅存 localStorage，与缓冲层同安全级别） */
export interface S3MediaConfig {
  /** S3 兼容端点，如 https://s3.example.com 或 R2 的 https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 对象键前缀（可空，等于桶根） */
  prefix: string;
  /** 公网访问基址（含 {path} 占位符；如 https://cdn.example.com/{path}）。缺省时不可复制外链 */
  publicBaseUrl: string;
}

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
  /** 图片上传默认方式（设置页配置，上传区默认选中该项）；视频恒为原样上传 */
  uploadMode: UploadMode;
  /** S3 兼容图床配置（sourceType='s3' 时必填） */
  s3?: S3MediaConfig;
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
