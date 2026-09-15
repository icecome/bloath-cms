import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../env';
import { success, error } from '../comment/utils/response';
import { ErrorCode } from '../comment/types';
import { requireAdminAuth } from '../middleware/auth';
import { upsertMessageReply, deleteMessageReply, attachReplies, ACTION_STATUS_MAP, updateMessageStatus, softDeleteMessage } from '../services/message.service';
import { listAdminMessages, batchOperateMessages, writeBatchAuditLogs } from '../services/admin.service';
import { getBlogPushSetting, saveBlogPushSetting } from '../services/settings.service';
import { ADMIN_SINGLE_ACTIONS, ADMIN_BATCH_ACTIONS } from '../comment/config';

const adminApp = new Hono<HonoEnv>();
adminApp.use('/api/admin/*', requireAdminAuth);

// GET /api/admin/messages — 管理面留言列表
adminApp.get('/api/admin/messages', async (c: Context<HonoEnv>) => {
  const status = c.req.query('status') || '';
  const size = Math.min(Math.max(parseInt(c.req.query('size') || '20', 10) || 20, 1), 50);
  const cursorRaw = parseInt(c.req.query('cursor') || '', 10);
  const cursor = Number.isFinite(cursorRaw) && cursorRaw > 0 ? cursorRaw : undefined;
  const { items, hasMore, total } = await listAdminMessages(c.env.DB, { status, size, cursor });
  const withReplies = await attachReplies(c.env.DB, items, true);
  return c.json(success({
    items: withReplies, hasMore,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    total,
  }));
});

// PATCH /api/admin/messages/:id — 单条操作
adminApp.patch('/api/admin/messages/:id', async (c: Context<HonoEnv>) => {
  const id = parseInt(c.req.param('id') || '', 10);
  let action: string | undefined;
  try { action = (await c.req.json<{ action?: string }>())?.action; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  if (!ADMIN_SINGLE_ACTIONS.includes(action || '')) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '无效的操作: ' + action), 400);
  }
  if (action === 'delete') await softDeleteMessage(c.env.DB, id, 'admin');
  else await updateMessageStatus(c.env.DB, id, action!, 'admin');
  return c.json(success(null, '操作成功'));
});

// DELETE /api/admin/messages/:id — 软删除
adminApp.delete('/api/admin/messages/:id', async (c: Context<HonoEnv>) => {
  const id = parseInt(c.req.param('id') || '', 10);
  await softDeleteMessage(c.env.DB, id, 'admin');
  return c.json(success(null, '留言已删除'));
});

// POST /api/admin/messages/:id/reply — 创建回复
// PUT /api/admin/messages/:id/reply — 更新最新回复
const replyHandler = async (c: Context<HonoEnv>, isUpdate: boolean) => {
  const id = parseInt(c.req.param('id') || '', 10);
  if (!id) return c.json(error(ErrorCode.VALIDATION_ERROR, '无效的留言 ID'), 400);
  let content = '';
  try { content = (await c.req.json<{ content?: string }>())?.content || ''; } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { notify } = await upsertMessageReply(c.env, id, content, 'admin', isUpdate);
  if (notify) c.executionCtx.waitUntil(notify);
  return c.json(success(null, isUpdate ? '回复已更新' : '回复成功'));
};
adminApp.post('/api/admin/messages/:id/reply', (c) => replyHandler(c, false));
adminApp.put('/api/admin/messages/:id/reply', (c) => replyHandler(c, true));

// DELETE /api/admin/messages/:id/reply?replyId=N
adminApp.delete('/api/admin/messages/:id/reply', async (c: Context<HonoEnv>) => {
  const id = parseInt(c.req.param('id') || '', 10);
  const replyId = c.req.query('replyId') ? parseInt(c.req.query('replyId')!, 10) : 0;
  if (!id) return c.json(error(ErrorCode.VALIDATION_ERROR, '无效的留言 ID'), 400);
  if (!replyId) return c.json(error(ErrorCode.VALIDATION_ERROR, '缺少 replyId'), 400);
  await deleteMessageReply(c.env.DB, id, replyId);
  return c.json(success(null, '回复已删除'));
});

// POST /api/admin/batch — 批量操作
adminApp.post('/api/admin/batch', async (c: Context<HonoEnv>) => {
  let body: { ids: number[]; action: string };
  try { body = await c.req.json(); } catch {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请求体格式错误'), 400);
  }
  const { ids, action } = body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '请选择要操作的留言'), 400);
  }
  if (ids.length > 100 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '批量操作上限 100 条且 ID 须为正整数'), 400);
  }
  if (!ADMIN_BATCH_ACTIONS.includes(action)) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, '无效的操作'), 400);
  }
  const { missingIds } = await batchOperateMessages(c.env.DB, ids, action);
  if (missingIds.length > 0) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, `以下留言不存在: ${missingIds.join(', ')}`), 404);
  }
  try { await writeBatchAuditLogs(c.env.DB, ids, action); } catch (logErr) {
    console.warn('[admin] 审计日志写入失败:', logErr);
  }
  return c.json(success(null, `已批量${action === 'delete' ? '删除' : ACTION_STATUS_MAP[action] || action} ${ids.length} 条`));
});

// GET /api/admin/settings/push
adminApp.get('/api/admin/settings/push', async (c: Context<HonoEnv>) => {
  return c.json(success(await getBlogPushSetting(c.env.DB)));
});

const pushSettingsSchema = z.object({
  enabled: z.boolean({ required_error: '参数错误: enabled 需为布尔' }),
  channelIds: z.array(z.number().int().positive(), { required_error: '参数错误: channelIds 需为正整数数组' }),
  emailEnabled: z.boolean().optional(),
});

// PUT /api/admin/settings/push
adminApp.put('/api/admin/settings/push', async (c: Context<HonoEnv>) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, parsed.error.errors[0]?.message ?? '参数错误'), 400);
  }
  const current = await getBlogPushSetting(c.env.DB);
  await saveBlogPushSetting(c.env.DB, {
    enabled: parsed.data.enabled,
    channelIds: parsed.data.channelIds,
    emailEnabled: parsed.data.emailEnabled ?? current.emailEnabled,
  });
  return c.json(success(await getBlogPushSetting(c.env.DB), '设置已保存'));
});

export default adminApp;
