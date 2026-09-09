// 站点 Profile：front-matter 格式 + 字段 schema + 映射规则预置
import type { FieldConfig, FieldGroup } from './types';

export type FrontmatterFormat = 'yaml' | 'toml';

export type ProfileId =
  | 'hugo'
  | 'hexo'
  | 'astro'
  | 'jekyll'
  | 'zola'
  | 'vitepress'
  | 'custom';

/**
 * 草稿语义决策（2026-09-08）：统一目录制（.draft/），不引入字段制，
 * 该字段仅保留字面量类型作为未来扩展位。
 */
export type DraftStrategy = 'directory';

export interface SiteProfile {
  id: ProfileId;
  label: string;
  format: FrontmatterFormat;
  /** 表单 schema：按 group 分组渲染 */
  fields: FieldConfig[];
  /** URL 控制字段语义（当前实现统一为「控制文件名」） */
  urlField: 'slug' | 'url' | 'permalink' | 'path';
  /** 自定义字段挂载块：Hugo → params，Zola → extra，null → 平铺 */
  customFieldsWrapper?: 'params' | 'extra' | null;
  /** 分类法挂载块：Zola → taxonomies */
  taxonomyWrapper?: 'taxonomies' | null;
  draftStrategy: DraftStrategy;
  /** 框架内容目录约定（供设置页一键应用） */
  contentPaths: string[];
}

// ---------- 字段构造辅助 ----------

function field(
  name: string,
  label: string,
  type: FieldConfig['type'],
  group: FieldGroup,
  extra?: Partial<FieldConfig>
): FieldConfig {
  return { name, label, type, group, ...extra };
}

const slugField = (label = 'URL') => field('url', label, 'slug', 'basic', { placeholder: '留空则自动生成：日期-标题' });
const titleField = () => field('title', '标题', 'string', 'basic', { placeholder: '文章标题' });
const dateField = () => field('date', '日期', 'datetime', 'basic');
const authorField = () => field('author', '作者', 'string', 'basic', { placeholder: '作者名称' });
const categoriesField = () => field('categories', '分类', 'multiselect', 'basic', { placeholder: '输入分类后回车' });
const tagsField = () => field('tags', '标签', 'multiselect', 'basic', { placeholder: '输入标签后回车' });
const coverField = () => field('cover', '封面图', 'image', 'advanced', { placeholder: '封面图 URL' });
const weightField = () => field('weight', '权重', 'number', 'advanced', { placeholder: '数值越大越靠前' });
const descriptionField = () => field('description', '描述', 'text', 'seo', { placeholder: 'SEO / 摘要描述' });
const customFieldsField = () => field('customFields', '自定义字段', 'custom-fields', 'custom');

// ---------- 个人组件：Hugo 博客自研字段，按使用频率排序 ----------
const picturesField = () => field('pictures', '说说图片', 'image-list', 'special', { placeholder: '图片 URL' });
const videoField = () => field('video', '说说视频', 'string-list', 'special', { placeholder: '视频 URL' });
const linkFields = () => [
  field('link', '说说链接', 'url', 'special', { placeholder: '链接 URL' }),
  field('link_text', '说说链接文本', 'string', 'special', { placeholder: '链接文本' })
];
const encryptFields = () => [
  field('encrypt', '加密', 'boolean', 'special'),
  field('encryptPasswordKey', '密码键名', 'string', 'special', { placeholder: '例如 private', showWhen: { field: 'encrypt', equals: true } }),
  field('encryptTitle', '加密标题', 'string', 'special', { placeholder: '需要密码访问', showWhen: { field: 'encrypt', equals: true } }),
  field('encryptMessage', '加密消息', 'text', 'special', { placeholder: '请输入密码查看内容', showWhen: { field: 'encrypt', equals: true } })
];

// ---------- 各框架预置 ----------

const hugoProfile: SiteProfile = {
  id: 'hugo',
  label: 'Hugo',
  format: 'yaml',
  fields: [
    // 基础信息
    slugField(),
    titleField(),
    dateField(),
    authorField(),
    categoriesField(),
    tagsField(),
    // 高级选项
    weightField(),
    coverField(),
    field('lastmod', '更新时间', 'datetime', 'advanced'),
    field('publishDate', '定时发布', 'datetime', 'advanced'),
    field('expiryDate', '过期时间', 'datetime', 'advanced'),
    // 个人组件（按使用频率排序）
    picturesField(),
    videoField(),
    ...linkFields(),
    ...encryptFields(),
    // SEO / 自定义
    descriptionField(),
    customFieldsField()
  ],
  urlField: 'url',
  customFieldsWrapper: 'params',
  taxonomyWrapper: null,
  draftStrategy: 'directory',
  contentPaths: ['content/posts']
};

const hexoProfile: SiteProfile = {
  id: 'hexo',
  label: 'Hexo',
  format: 'yaml',
  fields: [
    slugField('Permalink（控制文件名）'),
    titleField(),
    dateField(),
    field('updated', '更新时间', 'datetime', 'advanced'),
    authorField(),
    categoriesField(),
    tagsField(),
    coverField(),
    descriptionField(),
    picturesField(),
    videoField(),
    customFieldsField()
  ],
  urlField: 'permalink',
  customFieldsWrapper: null,
  taxonomyWrapper: null,
  draftStrategy: 'directory',
  contentPaths: ['source/_posts']
};

const astroProfile: SiteProfile = {
  id: 'astro',
  label: 'Astro',
  format: 'yaml',
  fields: [
    slugField('Slug（控制文件名）'),
    titleField(),
    field('pubDate', '发布日期', 'datetime', 'basic'),
    field('updatedDate', '更新日期', 'datetime', 'advanced'),
    field('heroImage', '主图', 'image', 'basic', { placeholder: '主图 URL' }),
    categoriesField(),
    tagsField(),
    descriptionField(),
    customFieldsField()
  ],
  urlField: 'slug',
  customFieldsWrapper: null,
  taxonomyWrapper: null,
  draftStrategy: 'directory',
  contentPaths: ['src/content/blog']
};

const jekyllProfile: SiteProfile = {
  id: 'jekyll',
  label: 'Jekyll',
  format: 'yaml',
  fields: [
    slugField('Permalink（控制文件名）'),
    titleField(),
    dateField(),
    categoriesField(),
    tagsField(),
    coverField(),
    descriptionField(),
    customFieldsField()
  ],
  urlField: 'permalink',
  customFieldsWrapper: null,
  taxonomyWrapper: null,
  draftStrategy: 'directory',
  contentPaths: ['_posts']
};

const zolaProfile: SiteProfile = {
  id: 'zola',
  label: 'Zola',
  format: 'toml',
  fields: [
    slugField('Slug（控制文件名）'),
    titleField(),
    dateField(),
    field('updated', '更新时间', 'datetime', 'advanced'),
    field('weight', '排序权重', 'number', 'advanced'),
    categoriesField(),
    tagsField(),
    descriptionField(),
    customFieldsField()
  ],
  urlField: 'slug',
  customFieldsWrapper: 'extra',
  taxonomyWrapper: 'taxonomies',
  draftStrategy: 'directory',
  contentPaths: ['content']
};

const vitepressProfile: SiteProfile = {
  id: 'vitepress',
  label: 'VitePress',
  format: 'yaml',
  fields: [
    slugField(),
    titleField(),
    dateField(),
    descriptionField(),
    customFieldsField()
  ],
  urlField: 'slug',
  customFieldsWrapper: null,
  taxonomyWrapper: null,
  draftStrategy: 'directory',
  contentPaths: ['docs']
};

const customProfile: SiteProfile = {
  id: 'custom',
  label: '通用（自定义）',
  format: 'yaml',
  fields: [
    slugField(),
    titleField(),
    dateField(),
    authorField(),
    categoriesField(),
    tagsField(),
    coverField(),
    weightField(),
    descriptionField(),
    customFieldsField()
  ],
  urlField: 'url',
  customFieldsWrapper: null,
  taxonomyWrapper: null,
  draftStrategy: 'directory',
  contentPaths: ['content/posts']
};

export const BUILTIN_PROFILES: Record<ProfileId, SiteProfile> = {
  hugo: hugoProfile,
  hexo: hexoProfile,
  astro: astroProfile,
  jekyll: jekyllProfile,
  zola: zolaProfile,
  vitepress: vitepressProfile,
  custom: customProfile
};

export const PROFILE_ORDER: ProfileId[] = [
  'hugo', 'hexo', 'astro', 'zola', 'jekyll', 'vitepress', 'custom'
];

export function getProfile(id: ProfileId | string | null | undefined): SiteProfile {
  if (id && id in BUILTIN_PROFILES) {
    return BUILTIN_PROFILES[id as ProfileId];
  }
  return customProfile;
}

export function listProfiles(): SiteProfile[] {
  return PROFILE_ORDER.map((id) => BUILTIN_PROFILES[id]);
}

/** 框架识别名 → ProfileId（未覆盖的框架回退 custom） */
export function frameworkToProfileId(frameworkName: string): ProfileId {
  switch (frameworkName) {
    case 'Hugo': return 'hugo';
    case 'Hexo': return 'hexo';
    case 'Astro': return 'astro';
    case 'Jekyll': return 'jekyll';
    case 'Zola': return 'zola';
    default: return 'custom';
  }
}
