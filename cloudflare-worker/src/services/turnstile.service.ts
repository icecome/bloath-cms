import { ApiError } from '../comment/utils/errors';
import { ErrorCode } from '../comment/types';

export async function verifyToken(token: string, ip: string, secret: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(ip)}`,
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json() as { success?: boolean };
    return data.success === true;
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new ApiError(ErrorCode.TURNSTILE_FAILED, '人机验证请求超时', 500);
    }
    throw new ApiError(ErrorCode.TURNSTILE_FAILED, '人机验证服务异常', 500);
  }
}
