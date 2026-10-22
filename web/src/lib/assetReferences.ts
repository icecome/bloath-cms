// 媒体资产引用扫描：在删除图片前，检查内容库文章对它的引用。
//
// 实现口径（对齐 Sveltia references.js 的文本通道）：
// - 做纯文本匹配，不做 Markdown AST 解析——覆盖 front-matter 字段
//   （cover / pictures 等图片 URL 字段）与正文 `![...](url)`、`<img src>` 即可，
//   语法级解析的边际收益不抵复杂度。
// - 匹配双形态：完整路径（含 CDN 域名等前缀，用 includes）与裸文件名
//   （要求「边界匹配」，两侧是非文件名字符，避免 `a-thumb.webp` 误判为 `a.webp`）。
// - 数据源：内容库列表的 EnhancedFileItem（front-matter 已由树级快照缓存）+
//   可选的正文读取回调，避免为一次删除再全量拉取文章。
import type { EnhancedFileItem } from './extractFrontMatter';
import type { MediaFile } from './mediaUtils';

/** 单条引用：哪篇文章、以何种形态引用了该资产 */
export interface AssetReference {
  /** 引用文章路径 */
  path: string;
  /** 文章标题（front-matter title，缺省用文件名） */
  title: string;
  /** 命中位置：front-matter 字段或正文 */
  where: 'frontmatter' | 'body';
}

export interface AssetReferenceScanResult {
  references: AssetReference[];
  /** 参与扫描的文章数 */
  scannedCount: number;
}

/** 裸文件名边界正则：文件名两侧必须是非文件名字符（引号/括号/空白/行首行尾等） */
function bareNameRegex(assetName: string): RegExp {
  const escaped = escapeRegExp(assetName);
  // \w 含字母数字下划线；再加 . 与 -（文件名合法字符），其余视为边界
  return new RegExp(`(^|[^\\w.\\-])${escaped}([^\\w.\\-]|$)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断某篇文章的 front-matter 是否引用了指定资产。
 * 匹配字段：cover、pictures、video、customFields（整体 JSON 序列化兜底）。
 */
export function articleReferencesAsset(
  item: EnhancedFileItem,
  assetPath: string,
  assetName: string
): AssetReference | null {
  const fm = item.frontmatter;
  if (!fm) return null;

  const fmValues: string[] = [];
  if (typeof fm.cover === 'string') fmValues.push(fm.cover);
  if (Array.isArray(fm.pictures)) fmValues.push(...fm.pictures.filter((v): v is string => typeof v === 'string'));
  if (Array.isArray(fm.video)) fmValues.push(...fm.video.filter((v): v is string => typeof v === 'string'));

  for (const value of fmValues) {
    // 完整路径 / CDN URL：includes 即可（资产路径是路径段，子串语义安全）
    if (value.includes(assetPath) || bareNameRegex(assetName).test(value)) {
      return { path: item.path, title: fm.title || item.name, where: 'frontmatter' };
    }
  }

  if (fm.customFields && JSON.stringify(fm.customFields).includes(assetPath)) {
    return { path: item.path, title: fm.title || item.name, where: 'frontmatter' };
  }

  return null;
}

/**
 * 判断正文文本是否引用了指定资产（完整路径或边界匹配的裸文件名）。
 * 独立导出供正文通道复用与测试。
 */
export function bodyReferencesAsset(body: string, assetPath: string, assetName: string): boolean {
  return body.includes(assetPath) || bareNameRegex(assetName).test(body);
}

/**
 * 扫描文章列表对某资产的引用。
 * @param articles 内容库文章（EnhancedFileItem，含 front-matter；来自树级快照缓存，
 *   调用方传入前无需额外网络请求）
 * @param asset 待检查的媒体资产
 * @param readArticleBody 可选：按文章路径返回正文全文，用于 Markdown 图片语法匹配。
 *   不传时只匹配 front-matter（列表页无正文缓存的默认形态）。
 */
export async function scanAssetReferences(
  articles: EnhancedFileItem[],
  asset: MediaFile,
  readArticleBody?: (articlePath: string) => Promise<string | null>
): Promise<AssetReferenceScanResult> {
  const references: AssetReference[] = [];

  for (const article of articles) {
    // front-matter 通道
    const fmHit = articleReferencesAsset(article, asset.path, asset.name);
    if (fmHit) {
      references.push(fmHit);
      continue;
    }

    // 正文通道（仅在调用方提供正文读取时启用）
    if (readArticleBody) {
      try {
        const body = await readArticleBody(article.path);
        if (body && bodyReferencesAsset(body, asset.path, asset.name)) {
          references.push({
            path: article.path,
            title: article.frontmatter?.title || article.name,
            where: 'body',
          });
        }
      } catch {
        // 单篇读取失败不阻断扫描：宁可漏报也不让删除流程卡死
        continue;
      }
    }
  }

  return { references, scannedCount: articles.length };
}
