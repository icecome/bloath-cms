// 入站邮件回信编排（Resend email.received）
import type { Env } from '../env';
import {
  claimWebhookEvent,
  extractTokenFromAddress,
  extractReplyText,
  extractPlainText,
} from './inbound.service';
import { findByReplyToken, appendEmailReply } from './message.service';

export async function handleReceivedEmail(
  env: Env,
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

    const emailResp = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
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
