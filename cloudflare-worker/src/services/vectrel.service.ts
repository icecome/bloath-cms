import type { Env } from '../env';
import type { MessageRow } from '../comment/types';
import { getBlogPushSetting } from './settings.service';

interface PushPayload {
  title: string;
  content: string;
  url?: string;
  detail?: { title: string; content: string };
  source?: string;
}

async function postPush(env: Env, payload: PushPayload): Promise<void> {
  if (!env.VECTREL_TOKEN) return;
  const setting = await getBlogPushSetting(env.DB);
  if (!setting.enabled) return;
  const body: Record<string, unknown> = { title: payload.title, content: payload.content };
  if (setting.channelIds.length) body.channelIds = setting.channelIds;
  if (payload.url !== undefined) body.url = payload.url;
  if (payload.detail !== undefined) body.detail = payload.detail;
  if (payload.source !== undefined) body.source = payload.source;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.VECTREL_TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  };
  try {
    const base = env.VECTREL_API_URL?.replace(/\/+$/, '');
    const resp = base
      ? await fetch(`${base}/push`, init)
      : env.PUSH_SERVICE
        ? await env.PUSH_SERVICE.fetch(new Request('https://vectrel.internal/push', init))
        : undefined;
    if (resp === undefined) {
      console.warn('[vectrelService] 未配置推送路由，跳过推送');
      return;
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.warn(`[vectrelService] 推送失败: HTTP ${resp.status} ${detail.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('[vectrelService] 推送异常:', err);
  }
}

const NL = '\n\n';
const beijingFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function formatBeijing(ts: string): string {
  const utc = new Date(`${ts.replace(' ', 'T')}Z`);
  if (Number.isNaN(utc.getTime())) return ts;
  return beijingFormatter.format(utc);
}

function firstLinePreview(text: string): string {
  const firstLine = text.split('\n', 1)[0].trim();
  return firstLine.length > 50 ? firstLine.slice(0, 50) + '…' : firstLine || '（空）';
}

export async function sendPushNotification(env: Env, msg: MessageRow): Promise<void> {
  const title = `博客新留言 - ${msg.visitor_name}`.slice(0, 200);
  const time = formatBeijing(msg.created_at);
  const preview = firstLinePreview(msg.content);
  const card = [`昵称：${msg.visitor_name}`, `内容：${preview}`, `来源：${msg.page_title}`, `时间：${time}`].join(NL);
  const detailText = [`昵称：${msg.visitor_name}`, `内容：${msg.content}`, `来源：${msg.page_title} (${msg.page_url})`, `时间：${time}`, `留言IP：${msg.visitor_ip}`, `邮箱：${msg.visitor_email}`].join(NL);
  await postPush(env, { title, content: card.slice(0, 1000), detail: { title, content: detailText.slice(0, 10000) }, source: '博客留言' });
}

export async function sendInboundReplyAlert(env: Env, content: string, fromEmail: string): Promise<void> {
  const preview = firstLinePreview(content);
  const fullText = `回信人: ${fromEmail}${NL}内容: ${content.slice(0, 200)}`;
  await postPush(env, {
    title: '收到访客邮箱回信',
    content: [`回信人：${fromEmail}`, `内容：${preview}`].join(NL),
    detail: { title: '收到访客邮箱回信', content: fullText },
    source: '博客回信',
  });
}
