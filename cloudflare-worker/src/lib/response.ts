// 统一 API 响应信封：全站端点共用。
// 原位于 comment/types.ts + comment/utils/response.ts（留言模块），留言模块下线后迁出。
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  timestamp: string;
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function success<T>(data?: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, message, data: data ?? null, timestamp: timestamp() };
}

export function error(code: number, message: string): ApiResponse<null> {
  return { code, message, data: null, timestamp: timestamp() };
}
