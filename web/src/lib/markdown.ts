// 轻量 Markdown 渲染器
// 覆盖常见格式：加粗、斜体、行内代码、代码块、链接、列表、引用、标题、段落
// 安全策略：先转义 HTML，再应用 Markdown 格式化

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
  let result = text;
  // 行内代码 `code`
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 加粗 **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体 *text*（避免与加粗冲突）
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // 链接 [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, url: string) => {
      const safeUrl = /^(https?:\/\/|mailto:|\/)/.test(url) ? url : '#';
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  );
  return result;
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  const escaped = escapeHtml(md);
  const lines = escaped.split('\n');
  const html: string[] = [];
  let inList = false;
  let inOl = false;
  let inBlockquote = false;
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  const closeList = () => {
    if (inList) { html.push('</ul>'); inList = false; }
    if (inOl) { html.push('</ol>'); inOl = false; }
  };
  const closeBlockquote = () => {
    if (inBlockquote) { html.push('</blockquote>'); inBlockquote = false; }
  };

  for (const line of lines) {
    // 代码块开始/结束
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre><code>${codeBlockContent.join('\n')}</code></pre>`);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        closeList();
        closeBlockquote();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') {
      closeList();
      closeBlockquote();
      continue;
    }

    // 标题
    const hMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (hMatch && hMatch[1] && hMatch[2]) {
      closeList();
      closeBlockquote();
      const level = hMatch[1].length;
      html.push(`<h${level}>${renderInline(hMatch[2])}</h${level}>`);
      continue;
    }

    // 引用
    if (trimmed.startsWith('&gt; ')) {
      closeList();
      if (!inBlockquote) { html.push('<blockquote>'); inBlockquote = true; }
      html.push(`<p>${renderInline(trimmed.slice(5))}</p>`);
      continue;
    }
    closeBlockquote();

    // 无序列表
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${renderInline(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inOl) { html.push('<ol>'); inOl = true; }
      html.push(`<li>${renderInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    closeList();

    // 分割线
    if (/^---+$/.test(trimmed)) {
      html.push('<hr />');
      continue;
    }

    // 段落
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }

  closeList();
  closeBlockquote();
  if (inCodeBlock) {
    html.push(`<pre><code>${codeBlockContent.join('\n')}</code></pre>`);
  }

  return html.join('\n');
}
