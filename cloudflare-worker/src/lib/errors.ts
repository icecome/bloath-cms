// 跨层错误类型（零依赖，可进 node --test）。
//
// 【为什么放在 lib/ 而不是 services/】
// 横切层 middleware/errorHandler.ts 需要按类型分派错误信封，若错误类定义在
// services/github.ts，横切层就反向依赖了具体业务模块——AGENTS.md §4 铁律 1
// 「依赖自上而下单向」的反例。错误类型属于基础设施，与 lib/api-error.ts 同级。
//
// 【为什么不用参数属性语法】`constructor(msg: string, public status: number)`
// 依赖 TS 的类型擦除之外的语法转换，node --experimental-strip-types 无法处理。
// 本模块要能被 services/*.test.ts 链路间接加载，必须用显式赋值。

/**
 * GitHub API 调用失败。携带原始 HTTP 状态码，供 errorHandler 原样透传
 * （403 速率限制由 throwGithubError 转成 503 后再构造，避免前端误判为认证过期）。
 */
export class GithubApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'GithubApiError';
    this.statusCode = statusCode;
  }
}
