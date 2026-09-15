import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../comment/types';
import { success, error } from '../comment/utils/response';
import {
  verifyWebhookSignature,
  extractTokenFromAddress,
  extractReplyText,
  extractPlainText,
  claimWebhookEvent,
} from '../services/inbound.service';
import { findByReplyToken, appendEmailReply } from '../services/message.service';

const inboundApp = new Hono<HonoEnv>();

// POST /api/inbound/replies — Resend email.received webhook 回调
inboundApp.post('/api/inbound/replies', async (c: Context<HonoEnv>) => {
  const rawBody = await c.req.text();
  const headers = c.req.raw.headers;

  const valid = await verifyWebhookSignature(c.env.RESEND_WEBHOOK_SECRET, rawBody, headers);
  if (!valid) {
    return c.json(error(ErrorCode.UNAUTHORIZED, '签名验证失败'), 401);
  }

  let event: { type?: string } & Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '非法请求体'), 400);
  }

  if (event.type !== 'email.received') {
    return c.json(success(null));
  }

  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : event;
  const emailId = data.email_id as string | undefined;
  if (!emailId) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '缺少 email_id'), 400);
  }

  const svixId = headers.get('svix-id') || '';
  c.executionCtx.waitUntil(handleReceivedEmail(c.env, data, emailId, svixId));
  return c.json(success(null));
});

async function handleReceivedEmail(
  env: HonoEnv['Bindings'],
  event: Record<string, unknown>,
  emailId: string,
  svixId: string
): Promise<void> {
  try {
    if (!svixId || !(await claimWebhookEvent(env.DB, svixId))) {
      console.warn('[inbound] 重复事件, 已跳过:', svixId || '(无 svix-id)');
      return;
    }

    const toField = (event.to as string[] | undefined) || [];
    const receivedFor = (event.received_for as string[] | undefined) || [];
    const allAddresses = [...receivedFor, ...toField];
    let token = '';
    for (const addr of allAddresses) {
      token = extractTokenFromAddress(addr);
      if (token) break;
    }
    if (!token) {
      console.warn('[inbound] 无法从收件地址解析 token:', JSON.stringify(allAddresses));
      return;
    }

    const message = await findByReplyToken(env.DB, token);
    if (!message) {
      console.warn('[inbound] token 未命中留言:', token);
      return;
    }

    const authHeader = `Bearer ${env.RESEND_API_KEY}`;
    const emailResp = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { 'Authorization': authHeader },
      signal: AbortSignal.timeout(10000),
    });
    if (!emailResp.ok) {
      console.warn(`[inbound] 拉取邮件正文失败: HTTP ${emailResp.status}`);
      return;
    }
    const emailData = (await emailResp.json()) as { text?: string; html?: string };
    const rawText = extractPlainText(emailData.text || '', emailData.html || '');
    const content = extractReplyText(rawText);
    if (!content) {
      console.warn('[inbound] 未提取到有效回信内容');
      return;
    }

    const fromEmail = (event.from as string | undefined) || '';
    const { alert } = await appendEmailReply(env, message.id, content, fromEmail);
    if (alert) {
      await alert.catch(() => undefined);
    }
    console.log(`[inbound] 留言 #${message.id} 收到回信, 已落库`);
  } catch (err) {
    console.error('[inbound] 处理回信异常:', err);
  }
}

export default inboundApp;
