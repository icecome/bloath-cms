import type { AdminMessage } from './commentApi';
import { MESSAGE_STATUS_LABEL } from '../../../shared/types';

export const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: MESSAGE_STATUS_LABEL.pending },
  { key: 'approved', label: MESSAGE_STATUS_LABEL.approved },
  { key: 'featured', label: MESSAGE_STATUS_LABEL.featured },
  { key: 'spam', label: MESSAGE_STATUS_LABEL.spam },
] as const;

export const STATUS_LABEL: Record<string, string> = MESSAGE_STATUS_LABEL;

export type ThreadPart = {
  type: 'visitor' | 'blogger' | 'inbound';
  content: string;
  time: string;
  replyId?: number;
  replyType?: string;
  replyFromEmail?: string;
};

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function formatFullTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function buildThread(msg: AdminMessage): ThreadPart[] {
  const parts: ThreadPart[] = [
    { type: 'visitor', content: msg.content, time: msg.created_at },
  ];
  msg.replies.forEach((r) => {
    const isInbound = r.reply_type.includes('邮箱') || !!r.reply_from_email;
    parts.push({
      type: isInbound ? 'inbound' : 'blogger',
      content: r.reply_content,
      time: r.created_at,
      replyId: r.id,
      replyType: r.reply_type,
      replyFromEmail: r.reply_from_email,
    });
  });
  parts.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return parts;
}
