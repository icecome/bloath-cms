// 留言模块业务错误码
export enum ErrorCode {
  VALIDATION_ERROR = 10001,
  RATE_LIMITED = 10002,
  INTERNAL_ERROR = 19999,
  MESSAGE_NOT_FOUND = 20001,
  INVALID_STATUS_TRANSITION = 20002,
  UNAUTHORIZED = 40101,
  TURNSTILE_FAILED = 50001,
}

// messages 表行结构
export interface MessageRow {
  id: number;
  visitor_name: string;
  visitor_email: string;
  visitor_website: string;
  visitor_ip: string;
  user_agent: string;
  client_hash: string;
  content: string;
  quoted_text: string;
  page_url: string;
  page_title: string;
  status: 'pending' | 'approved' | 'featured' | 'spam';
  is_deleted: number;
  needs_review: number;
  reply_content: string;
  reply_at: string | null;
  reply_token: string;
  created_at: string;
  updated_at: string;
}

// replies 表行结构
export interface ReplyRow {
  id: number;
  message_id: number;
  reply_content: string;
  reply_type: '博主' | '邮箱回信';
  reply_from_email: string;
  created_at: string;
}

export type MessageWithReplies = MessageRow & { replies: ReplyRow[] };

// POST /api/message 请求体
export interface CreateMessageInput {
  visitor_name: string;
  visitor_email: string;
  visitor_website: string;
  content: string;
  quoted_text: string;
  page_url: string;
  page_title: string;
  turnstile_token: string;
  cf_verified: boolean;
}

// GET /api/messages 查询参数
export interface ListParams {
  status?: string;
  page_url?: string;
  size: number;
  cursor?: number;
}

// 分页响应
export interface PaginatedResult<T> {
  items: T[];
  has_more: boolean;
  next_cursor: number | null;
  total: number;
}

// 统一 API 响应格式（留言模块）
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  timestamp: string;
}
