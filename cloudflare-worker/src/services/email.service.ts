import MarkdownIt from 'markdown-it';
import type { Env } from '../env';
import type { MessageRow } from '../comment/types';
import { escapeHtml } from '../comment/utils/sanitizer';

const PALETTE = {
  bg: '#F1F0ED', surface: '#FAFAF8', ink: '#33332F', ink2: '#6F6D65',
  ink3: '#9A978B', line: '#DDDCD8', lineLight: '#E8E7E4', brand: '#9B2226',
};
const FONT = "'Noto Serif CJK SC','Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',Georgia,serif";
const MONO = "'SF Mono',Menlo,Consolas,monospace";

function sanitizeUrl(url: string): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url, 'https://icecome.com');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      if (parsed.protocol === 'mailto:') return url;
      return parsed.toString();
    }
  } catch { /* invalid */ }
  return '#';
}

const PRESERVED_ATTRS: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt'],
};

function extractAttr(attrs: string, attrName: string): string | null {
  const m = attrs.match(new RegExp(`\\s${attrName}="([^"]*)"`));
  return m ? m[1] : null;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
md.validateLink = (url: string) => {
  const clean = url.trim().toLowerCase();
  return clean === '' || clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('mailto:') || clean.startsWith('#');
};

export function renderMarkdown(content: string): string {
  const raw = md.render(content || '');
  let inPre = false;
  return raw.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => {
    const name = (tag.match(/[a-zA-Z][a-zA-Z0-9]*/) || [''])[0];
    const closing = tag.startsWith('</');
    if (name === 'pre') {
      if (closing) { inPre = false; return `</pre>`; }
      inPre = true;
      return `<pre style="margin:14px 0;padding:14px 16px;background:${PALETTE.surface};border:1px solid ${PALETTE.line};border-radius:8px;font-family:${MONO};font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;">`;
    }
    const style = (() => {
      switch (name) {
        case 'a': return `color:${PALETTE.brand};text-decoration:underline;text-underline-offset:2px;`;
        case 'p': return `margin:12px 0;line-height:1.8;`;
        case 'h1': return `font-size:24px;font-weight:600;color:${PALETTE.ink};margin:20px 0 8px;`;
        case 'h2': return `font-size:20px;font-weight:600;color:${PALETTE.ink};margin:18px 0 6px;`;
        case 'h3': return `font-size:17px;font-weight:600;color:${PALETTE.ink};margin:16px 0 6px;`;
        case 'ul': case 'ol': return `margin:12px 0;padding-left:22px;`;
        case 'li': return `margin:6px 0;line-height:1.8;`;
        case 'blockquote': return `margin:14px 0;padding:10px 16px;border-left:3px solid ${PALETTE.brand};color:${PALETTE.ink2};background:${PALETTE.surface};border-radius:0 4px 4px 0;font-style:italic;`;
        case 'code': return inPre ? `` : `font-family:${MONO};font-size:13px;background:${PALETTE.surface};border:1px solid ${PALETTE.line};padding:1px 5px;border-radius:4px;color:${PALETTE.brand};`;
        case 'hr': return `border:none;border-top:1px solid ${PALETTE.line};margin:16px 0;`;
        case 'img': return `max-width:100%;height:auto;border-radius:8px;margin:12px 0;`;
        default: return '';
      }
    })();
    let preserved = '';
    if (!closing) {
      const attrStr = tag.slice(1 + name.length, tag.length - 1);
      for (const attrName of PRESERVED_ATTRS[name] || []) {
        const value = extractAttr(attrStr, attrName);
        if (value !== null) preserved += ` ${attrName}="${escapeHtml(value)}"`;
      }
    }
    return closing ? `</${name}>` : `<${name}${preserved} style="${style}">`;
  });
}

function field(label: string, valueHtml: string): string {
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${PALETTE.lineLight};">
    <div style="font-size:12px;letter-spacing:0.08em;color:${PALETTE.ink3};margin-bottom:6px;">${label}</div>
    <div style="font-size:15px;line-height:1.8;color:${PALETTE.ink};">${valueHtml}</div>
  </td></tr>`;
}

function emailShell(kicker: string, title: string, bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.bg};">
  <tr><td style="padding:40px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="640" align="center" style="font-family:${FONT};">
      <tr><td style="padding:8px 0 4px;">
        <div style="font-size:12px;letter-spacing:0.18em;color:${PALETTE.brand};">${kicker}</div>
        <h1 style="font-size:22px;font-weight:600;color:${PALETTE.ink};margin:10px 0 0;line-height:1.4;letter-spacing:0.03em;">${title}</h1>
        <div style="border-top:1px solid ${PALETTE.line};margin:22px 0 0;"></div>
      </td></tr>
      <tr><td style="padding:4px 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${bodyHtml}</table>
      </td></tr>
      <tr><td style="padding:24px 0 0;">
        <div style="border-top:1px solid ${PALETTE.lineLight};"></div>
        <p style="font-size:12px;line-height:1.8;color:${PALETTE.ink3};text-align:center;margin:14px 0 0;">此邮件由博客留言系统自动发送</p>
      </td></tr>
    </table>
  </td></tr></table>`;
}

async function sendViaResend(env: Env, payload: Record<string, unknown>, logLabel: string): Promise<void> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) console.warn(`[emailService] ${logLabel}失败: HTTP ${response.status}`);
  } catch (err) {
    console.error(`[emailService] ${logLabel}异常:`, err);
  }
}

export async function sendNotificationEmail(env: Env, msg: MessageRow): Promise<void> {
  const articleLink = `<a style="color:${PALETTE.brand};text-decoration:underline;" href="${sanitizeUrl(msg.page_url)}" target="_blank" rel="noopener">${escapeHtml(msg.page_title)}</a>`;
  const body = field('昵称', escapeHtml(msg.visitor_name))
    + (msg.visitor_email ? field('邮箱', escapeHtml(msg.visitor_email)) : '')
    + field('留言内容', renderMarkdown(msg.content))
    + field('来源文章', articleLink)
    + field('时间', escapeHtml(msg.created_at));
  await sendViaResend(env, {
    from: env.RESEND_FROM || 'noreply@icecome.com',
    to: [env.BLOGGER_EMAIL],
    subject: `来自「${msg.visitor_name}」的新留言`,
    html: emailShell('INBOX', '你收到了一条新留言', body),
  }, '发送');
}

export async function sendReplyEmail(env: Env, msg: MessageRow): Promise<void> {
  if (!msg.visitor_email) return;
  const replyTo = `reply+${msg.reply_token || ''}@${env.INBOUND_REPLY_DOMAIN}`;
  const articleLink = `<a style="color:${PALETTE.brand};text-decoration:underline;" href="${sanitizeUrl(msg.page_url)}" target="_blank" rel="noopener">${escapeHtml(msg.page_title)}</a>`;
  const originalText = msg.content;
  const original = originalText.length > 200 ? `${originalText.slice(0, 200)}…` : originalText;
  const body = field('你的留言', renderMarkdown(original))
    + field('博主回复', renderMarkdown(msg.reply_content))
    + field('原文', articleLink);
  await sendViaResend(env, {
    from: env.RESEND_FROM || 'noreply@icecome.com',
    to: [msg.visitor_email],
    reply_to: replyTo,
    subject: '博主回复了你的留言',
    html: emailShell('REPLY', '你的留言收到了博主的回复', body),
  }, '回复邮件发送');
}
