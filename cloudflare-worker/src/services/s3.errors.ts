export class S3Error extends Error {
  readonly op: string;
  readonly status: number;
  readonly detail: string;

  constructor(op: string, status: number, detail: string) {
    super(`${op} 失败 (${status})`);
    this.name = 'S3Error';
    this.op = op;
    this.status = status;
    this.detail = detail.slice(0, 200);
  }
}

export function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '127.0.0.1' ||
    host === '169.254.169.254' ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    return true;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  // RFC 6598 CGNAT 共享地址空间 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isBlockedS3Endpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
    return isPrivateOrBlockedHost(url.hostname);
  } catch {
    return true;
  }
}
