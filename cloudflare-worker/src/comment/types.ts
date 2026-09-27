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

// 行结构定义在 shared/types.ts，前后端共用一份，避免字段漂移需两处同步修改
export type { MessageRecord as MessageRow, MessageReplyRow as ReplyRow, MessageStatus } from '../../../shared/types';
import type { MessageRecord, MessageReplyRow } from '../../../shared/types';

export type MessageWithReplies = MessageRecord & { replies: MessageReplyRow[] };

// POST /api/message 请求体的类型由 comment/utils/validators.ts 的 Zod schema 推断
// （单一真源：schema 同时承担运行时校验与类型导出，避免手写 interface 与 schema 不一致）

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
