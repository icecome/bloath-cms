import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../lib/error-codes';
import { error } from '../lib/response';
import { ApiError } from '../lib/api-error';
import { GithubApiError } from '../services/github';

export const errorHandler = (err: Error, c: Context<HonoEnv>): Response => {
  if (err instanceof ApiError) {
    return c.json(error(err.code, err.message), err.status as ContentfulStatusCode);
  }
  if (err instanceof GithubApiError) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, err.message), err.statusCode as ContentfulStatusCode);
  }
  if (err instanceof ZodError) {
    // zod v4：errors 访问器更名 issues（v3 的 .errors 是 .issues 的别名）
    const message = err.issues[0]?.message || '请求参数校验失败';
    return c.json(error(ErrorCode.VALIDATION_ERROR, message), 400);
  }
  console.error('[errorHandler] 未捕获异常：', err);
  return c.json(error(ErrorCode.INTERNAL_ERROR, '服务器内部错误'), 500);
};
