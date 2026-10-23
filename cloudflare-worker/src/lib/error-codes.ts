// 业务错误码：全站 API 统一使用（编辑器与管理接口共用）。
// 原位于 comment/types.ts（留言模块），留言模块下线后迁出为通用基础设施。
export enum ErrorCode {
  VALIDATION_ERROR = 10001,
  RATE_LIMITED = 10002,
  /** 413：请求体超过端点允许的体积（媒体二进制上传用） */
  PAYLOAD_TOO_LARGE = 10003,
  INTERNAL_ERROR = 19999,
  MESSAGE_NOT_FOUND = 20001,
  INVALID_STATUS_TRANSITION = 20002,
  UNAUTHORIZED = 40101,
  TURNSTILE_FAILED = 50001,
}
