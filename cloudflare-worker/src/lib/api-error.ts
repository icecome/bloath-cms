// 携带业务码与 HTTP 状态的 API 错误：由 errorHandler 统一映射为响应信封。
// 原位于 comment/utils/errors.ts（留言模块），留言模块下线后迁出。
export class ApiError extends Error {
  code: number;
  status: number;

  // 不用构造函数参数属性（`constructor(public code: number)`）：
  // node --experimental-strip-types 的 strip-only 模式不支持该语法，测试链路会失败。
  constructor(code: number, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}
