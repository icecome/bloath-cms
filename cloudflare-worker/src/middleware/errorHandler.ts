import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { HonoEnv } from '../env';
import { ErrorCode } from '../comment/types';
import { error } from '../comment/utils/response';
import { ApiError } from '../comment/utils/errors';
import { GithubApiError } from '../services/github';

export const errorHandler = (err: Error, c: Context<HonoEnv>): Response => {
  if (err instanceof ApiError) {
    return c.json(error(err.code, err.message), err.status as ContentfulStatusCode);
  }
  if (err instanceof GithubApiError) {
    return c.json(error(ErrorCode.VALIDATION_ERROR, err.message), err.statusCode as ContentfulStatusCode);
  }
  if (err instanceof ZodError) {
    const message = err.errors[0]?.message || '参数校验失败';
    return c.json(error(ErrorCode.VALIDATION_ERROR, message), 400);
  }
  console.error('[errorHandler] 未捕获异常:', err);
  return c.json(error(ErrorCode.INTERNAL_ERROR, '服务器内部错误'), 500);
};
