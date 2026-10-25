// 业务错误码：全站 API 统一使用（编辑器与所有端点共用）。
// 原位于 comment/types.ts（留言模块），留言模块下线后迁出为通用基础设施。
// 已删除 MESSAGE_NOT_FOUND / INVALID_STATUS_TRANSITION / TURNSTILE_FAILED：
// 三者是留言模块与 Turnstile 防护的专用码，随模块下线失去全部消费点（audit m-05）。
export enum ErrorCode {
  VALIDATION_ERROR = 10001,
  RATE_LIMITED = 10002,
  /** 413：请求体超过端点允许的体积（媒体二进制上传用） */
  PAYLOAD_TOO_LARGE = 10003,
  INTERNAL_ERROR = 19999,
  UNAUTHORIZED = 40101,
}
