import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../comment/types';
import { success, error } from '../comment/utils/response';
import { verifyWebhookSignature } from '../services/inbound.service';
import { handleReceivedEmail } from '../services/inboundReply.service';

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

export default inboundApp;
