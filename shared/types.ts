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
export type CdnProvider = 'jsdelivr' | 'github_raw' | 'custom';

export type DuplicateStrategy = 'skip' | 'overwrite';

/** 图片上传方式：compress=重编码为 WebP（默认）；original=保留原始格式与字节 */
export type UploadMode = 'compress' | 'original';

export type MediaSourceType = 'standalone' | 'repo-dir' | 'image-branch' | 's3';

/** 后端媒体仓库类型（与旧 MediaSourceType 同枚举，语义并行：多实例可同时启用） */
export type MediaBackendKind = MediaSourceType;

/** S3 兼容图床的外链视图配置（sourceType = 's3' 时生效）。
 *  连接凭据（endpoint/bucket/AK/SK）已迁至 Worker 侧加密存储（mediaS3Config.service，
 *  P1-001）：浏览器仅持有 publicBaseUrl——它是拼外链用的公开信息，不含敏感值。 */
export interface S3MediaConfig {
  /** 公网访问基址（含 {path} 占位符；如 https://cdn.example.com/{path}）。缺省时不可复制外链 */
  publicBaseUrl: string;
}

/**
 * 并行后端媒体仓库：可同时启用多个不同类型/同类型的后端，
 * 上传时选择目标仓库，未指定则落 defaultBackendId 对应的默认仓库。
 *
 * 定位参数按 kind 取用：
 *  - standalone：owner/repo/branch（独立图床仓库）
 *  - repo-dir：   pathPrefix（当前博客仓库子目录）
 *  - image-branch：branch = imageBranchName 对应的独立分支
 *  - s3：         s3PublicBaseUrl（外链基址；凭据在 Worker 侧按 id 分键加密存储）
 */
export interface MediaBackend {
  /** 稳定标识（创建时生成一次，不随 label 变更；用于 Worker S3 配置分键） */
  id: string;
  kind: MediaBackendKind;
  /** 显示名（上传下拉 / 页面切换器用） */
  label: string;
  /** 并行开关：关闭后不出现在上传下拉与列表选择器中 */
  enabled: boolean;
  // —— GitHub 类定位参数 ——
  owner?: string;
  repo?: string;
  branch?: string;
  /** repo-dir 用：存放目录（空 = assets） */
  pathPrefix?: string;
  // —— S3 定位参数（凭据在 Worker 侧，浏览器仅持外链基址） ——
  s3PublicBaseUrl?: string;
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
  /**
   * 并行后端媒体仓库列表（新）。存量配置无此字段：读取时由旧 sourceType+扁平字段
   * 迁移为单个 backend 并写入；旧字段保留为「迁移源」，不再作为运行时权威。
   */
  backends: MediaBackend[];
  /** 默认后端 id：上传未指定目标时回退到此；媒体库页初始活跃仓库也指向它 */
  defaultBackendId: string;
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
