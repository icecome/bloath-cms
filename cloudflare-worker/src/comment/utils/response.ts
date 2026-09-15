import type { ApiResponse } from '../types';

export function timestamp(): string {
  return new Date().toISOString();
}

export function success<T>(data?: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, message, data: data ?? null, timestamp: timestamp() };
}

export function error(code: number, message: string): ApiResponse<null> {
  return { code, message, data: null, timestamp: timestamp() };
}
