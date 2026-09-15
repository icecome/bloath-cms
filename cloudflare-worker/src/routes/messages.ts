import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../comment/types';
import { success, error } from '../comment/utils/response';
import {
  createMessage, listMessages, getPublicMessageById,
  updateMessageStatus, softDeleteMessage, attachReplies,
} from '../services/message.service';

const messagesApp = new Hono<HonoEnv>();

// POST /api/message — 公开提交留言
messagesApp.post('/api/message', async (c: Context<HonoEnv>) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400); }
  const ip = c.req.header('CF-Connecting-IP')
    || (c.env.ENVIRONMENT !== 'production' ? c.req.header('X-Forwarded-For') : undefined)
    || 'unknown';
  const ua = c.req.header('User-Agent') || '';
  const result = await createMessage(c.env, body, ip, ua);
  if (result.notifications) c.executionCtx.waitUntil(result.notifications);
  return c.json(success({ id: result.id, status: 'pending' }, '留言提交成功'), 201);
});

// GET /api/messages — 公开留言列表
messagesApp.get('/api/messages', async (c: Context<HonoEnv>) => {
  const params = {
    status: c.req.query('status') || undefined,
    page_url: c.req.query('page_url') || undefined,
    size: parseInt(c.req.query('size') || '10', 10),
    cursor: c.req.query('cursor') ? parseInt(c.req.query('cursor')!, 10) : undefined,
  };
  const result = await listMessages(c.env.DB, params);
  return c.json(success(result));
});

// GET /api/messages/:id — 公开单条
messagesApp.get('/api/messages/:id', async (c: Context<HonoEnv>) => {
  const id = parseInt(c.req.param('id') || '', 10);
  const msg = await getPublicMessageById(c.env.DB, id);
  if (!msg) return c.json(error(ErrorCode.MESSAGE_NOT_FOUND, '留言不存在'), 404);
  return c.json(success(msg));
});

export default messagesApp;
