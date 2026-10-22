// 媒体资产引用扫描单元测试
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  articleReferencesAsset,
  bodyReferencesAsset,
  scanAssetReferences,
  type AssetReference,
} from './assetReferences.ts';
import type { EnhancedFileItem } from './extractFrontMatter.ts';
import type { MediaFile } from './mediaUtils.ts';

function makeArticle(over: Partial<EnhancedFileItem> = {}): EnhancedFileItem {
  return {
    name: '文章.md',
    path: 'content/posts/文章.md',
    sha: 'sha-1',
    type: 'file',
    frontmatter: { title: '测试文章' },
    ...over,
  };
}

function makeAsset(over: Partial<MediaFile> = {}): MediaFile {
  return {
    name: 'cover.webp',
    path: 'assets/cover.webp',
    sha: 'sha-a',
    size: 1000,
    url: 'https://cdn.example.com/assets/cover.webp',
    lastModified: 0,
    ...over,
  };
}

describe('articleReferencesAsset（front-matter 通道）', () => {
  it('无 front-matter 时返回 null', () => {
    const item = makeArticle({ frontmatter: undefined });
    assert.equal(articleReferencesAsset(item, 'assets/cover.webp', 'cover.webp'), null);
  });

  it('cover 字段完整路径命中', () => {
    const item = makeArticle({ frontmatter: { title: 'A', cover: 'https://cdn.example.com/assets/cover.webp' } });
    const hit = articleReferencesAsset(item, 'assets/cover.webp', 'cover.webp');
    assert.equal(hit?.where, 'frontmatter');
    assert.equal(hit?.title, 'A');
  });

  it('cover 字段裸文件名命中', () => {
    const item = makeArticle({ frontmatter: { title: 'A', cover: 'cover.webp' } });
    assert.ok(articleReferencesAsset(item, 'assets/cover.webp', 'cover.webp'));
  });

  it('pictures 数组命中', () => {
    const item = makeArticle({
      frontmatter: { title: 'A', pictures: ['https://cdn.example.com/assets/cover.webp', 'other.png'] },
    });
    assert.ok(articleReferencesAsset(item, 'assets/cover.webp', 'cover.webp'));
  });

  it('非图片字段不参与匹配：tags 中的同名文本不算引用', () => {
    const item = makeArticle({ frontmatter: { title: 'A', tags: ['cover'] } });
    assert.equal(articleReferencesAsset(item, 'assets/cover.webp', 'cover.webp'), null);
  });

  it('裸文件名边界匹配：thumb 后缀不误报', () => {
    const item = makeArticle({ frontmatter: { title: 'A', cover: 'cover-thumb.webp' } });
    assert.equal(articleReferencesAsset(item, 'assets/cover.webp', 'cover.webp'), null);
  });

  it('自定义字段整体序列化命中', () => {
    const item = makeArticle({
      frontmatter: { title: 'A', customFields: { banner: '/assets/cover.webp' } },
    });
    assert.ok(articleReferencesAsset(item, 'assets/cover.webp', 'cover.webp'));
  });

  it('正则特殊字符的文件名不抛错且按字面匹配', () => {
    const item = makeArticle({ frontmatter: { title: 'A', cover: 'a+b (1).webp' } });
    assert.ok(articleReferencesAsset(item, 'assets/a+b (1).webp', 'a+b (1).webp'));
  });
});

describe('bodyReferencesAsset（正文通道）', () => {
  it('Markdown 图片语法完整路径命中', () => {
    const body = '看图 ![封面](https://cdn.example.com/assets/cover.webp)';
    assert.ok(bodyReferencesAsset(body, 'assets/cover.webp', 'cover.webp'));
  });

  it('HTML img 标签命中', () => {
    const body = '<img src="/assets/cover.webp" alt="封面">';
    assert.ok(bodyReferencesAsset(body, 'assets/cover.webp', 'cover.webp'));
  });

  it('裸文件名边界命中', () => {
    const body = '![封面](cover.webp)';
    assert.ok(bodyReferencesAsset(body, 'assets/cover.webp', 'cover.webp'));
  });

  it('无关正文不命中', () => {
    assert.ok(!bodyReferencesAsset('今天天气不错', 'assets/cover.webp', 'cover.webp'));
  });

  it('子串文件名不误报（cover2.webp ≠ cover.webp）', () => {
    assert.ok(!bodyReferencesAsset('![x](cover2.webp)', 'assets/cover.webp', 'cover.webp'));
  });
});

describe('scanAssetReferences', () => {
  it('front-matter 命中短路，不调用正文读取', async () => {
    let bodyReads = 0;
    const articles = [makeArticle({ frontmatter: { title: 'A', cover: 'cover.webp' } })];
    const { references, scannedCount } = await scanAssetReferences(
      articles,
      makeAsset(),
      async () => {
        bodyReads++;
        return null;
      }
    );
    assert.equal(bodyReads, 0);
    assert.equal(scannedCount, 1);
    assert.equal(references.length, 1);
    assert.equal(references[0]?.where, 'frontmatter');
  });

  it('正文通道：front-matter 未命中时读正文判定', async () => {
    const articles = [makeArticle()];
    const { references } = await scanAssetReferences(
      articles,
      makeAsset(),
      async () => '正文 ![图](assets/cover.webp) 结束'
    );
    assert.equal(references.length, 1);
    assert.equal(references[0]?.where, 'body');
  });

  it('正文读取失败不阻断，返回空引用', async () => {
    const articles = [makeArticle()];
    const { references } = await scanAssetReferences(
      articles,
      makeAsset(),
      async () => {
        throw new Error('network down');
      }
    );
    assert.equal(references.length, 0);
  });

  it('未提供正文读取时只扫 front-matter', async () => {
    const articles = [makeArticle()];
    const { references } = await scanAssetReferences(articles, makeAsset());
    assert.equal(references.length, 0);
  });

  it('多篇文章混合命中：front-matter 与 body 各一条', async () => {
    const articles = [
      makeArticle({ path: 'content/a.md', frontmatter: { title: 'A', cover: 'cover.webp' } }),
      makeArticle({ path: 'content/b.md', frontmatter: { title: 'B' } }),
    ];
    const { references } = await scanAssetReferences(
      articles,
      makeAsset(),
      async (articlePath) =>
        articlePath === 'content/b.md' ? '![x](assets/cover.webp)' : null
    );
    const paths = references.map((r: AssetReference) => r.path).sort();
    assert.deepEqual(paths, ['content/a.md', 'content/b.md']);
  });
});
