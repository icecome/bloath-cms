// 留言 Markdown 渲染（与后端邮件渲染保持一致的规则）
// 采用动态 import：markdown-it 约 100KB，不进入主包，仅在消息页首次渲染时加载
// 配置必须与 cloudflare-worker/src/services/email.service.ts 的渲染器保持同步，
// 否则同一段留言在站内与邮件中的排版会出现差异。

// markdown-it v15 的类型入口为 `export = MarkdownIt`（CJS 风格），
// 无法用 `import type X from` 取实例类型，故从动态 import 的返回值反推。
type Renderer = Awaited<ReturnType<typeof createRenderer>>;

let rendererPromise: Promise<Renderer> | null = null;

async function createRenderer() {
  const { default: MarkdownItCtor } = await import('markdown-it');
  const md = new MarkdownItCtor({ html: false, linkify: true, breaks: true });
  // 与后端一致：仅放行 http(s)/mailto/锚点，拦截 javascript: 等危险协议
  md.validateLink = (url: string) => {
    const clean = url.trim().toLowerCase();
    return clean === '' || clean.startsWith('http://') || clean.startsWith('https://')
      || clean.startsWith('mailto:') || clean.startsWith('#');
  };
  return md;
}

/** 懒加载渲染器实例；多次调用复用同一 Promise，避免重复下载与初始化 */
function getRenderer(): Promise<Renderer> {
  if (!rendererPromise) rendererPromise = createRenderer();
  return rendererPromise;
}

/**
 * 渲染留言正文为 HTML。
 * markdown-it 的 html:false 已确保用户输入不会被当作标签解析；调用方仅负责注入渲染结果。
 */
export async function renderMessageMarkdown(content: string): Promise<string> {
  const md = await getRenderer();
  return md.render(content || '');
}
