// 留言模块 API 客户端（与 Worker 的 /api/admin/* 和 /api/messages 通信）
import { API_BASE } from './constants';
import { requestJson } from './http';

const API_TIMEOUT_MS = 10000;

function commentFetch<T>(url: string, options?: RequestInit): Promise<T> {
  return requestJson<T>(url, { ...options, timeoutMs: API_TIMEOUT_MS }, API_BASE);
}

// ---------- 类型 ----------

export interface MessageReply {
  id: number;
  message_id: number;
  reply_content: string;
  reply_type: string;
  reply_from_email: string;
  created_at: string;
}

export interface AdminMessage {
  id: number;
  visitor_name: string;
  visitor_email: string;
  visitor_website: string;
  visitor_ip: string;
  content: string;
  quoted_text: string;
  page_url: string;
  page_title: string;
  status: 'pending' | 'approved' | 'featured' | 'spam';
  is_deleted: number;
  needs_review: number;
  reply_content: string;
  reply_at: string | null;
  created_at: string;
  updated_at: string;
  replies: MessageReply[];
}

export interface AdminListResult {
  items: AdminMessage[];
  hasMore: boolean;
  nextCursor: number | null;
  total: number;
}

export interface BlogPushSetting {
  enabled: boolean;
  channelIds: number[];
  emailEnabled: boolean;
}

// ---------- 管理面 API ----------

export function listAdminMessages(params: { status?: string; size?: number; cursor?: number } = {}): Promise<AdminListResult> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.size) query.set('size', String(params.size));
  if (params.cursor) query.set('cursor', String(params.cursor));
  const qs = query.toString();
  return commentFetch<AdminListResult>(`/api/admin/messages${qs ? `?${qs}` : ''}`);
}

export function patchMessageAction(id: number, action: string): Promise<null> {
  return commentFetch<null>(`/api/admin/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

export function createReply(id: number, content: string): Promise<null> {
  return commentFetch<null>(`/api/admin/messages/${id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export function updateReply(id: number, content: string): Promise<null> {
  return commentFetch<null>(`/api/admin/messages/${id}/reply`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export function deleteReply(messageId: number, replyId: number): Promise<null> {
  return commentFetch<null>(`/api/admin/messages/${messageId}/reply?replyId=${replyId}`, {
    method: 'DELETE',
  });
}

export function batchOperateMessages(ids: number[], action: string): Promise<null> {
  return commentFetch<null>(`/api/admin/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, action }),
  });
}

export function getPushSetting(): Promise<BlogPushSetting> {
  return commentFetch<BlogPushSetting>(`/api/admin/settings/push`);
}

export function savePushSetting(setting: BlogPushSetting): Promise<BlogPushSetting> {
  return commentFetch<BlogPushSetting>(`/api/admin/settings/push`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setting),
  });
}
