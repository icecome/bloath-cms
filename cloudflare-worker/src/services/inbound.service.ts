import { timingSafeEqual } from 'hono/utils/buffer';
import { base64ToBytes, bytesToBase64 } from '../comment/utils/base64';

// ---- Resend inbound webhook 验签 (Svix 机制) ----

function base64UrlToBase64(s: string): string {
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

function decodeSecret(secret: string): Uint8Array {
  let b64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  b64 = base64UrlToBase64(b64);
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return base64ToBytes(padded);
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function signToString(sig: Uint8Array): string {
  return bytesToBase64(sig);
}

export async function verifyWebhookSignature(secret: string, payload: string, headers: Headers): Promise<boolean> {
  if (!secret) return false;
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;
  const tsNum = parseInt(timestamp, 10);
  if (Number.isNaN(tsNum)) return false;
  if (Math.abs(Date.now() - tsNum * 1000) > 5 * 60 * 1000) return false;
  const expected = await hmacSha256(decodeSecret(secret), `${id}.${timestamp}.${payload}`);
  const expectedStr = signToString(expected);
  const receivedSignatures = signatureHeader.split(' ').map((s) => s.trim()).filter(Boolean);
  for (const sig of receivedSignatures) {
    const sep = sig.indexOf(',');
    if (sep < 0) continue;
    const version = sig.slice(0, sep);
    const providedSignature = sig.slice(sep + 1);
    if (version !== 'v1' || !providedSignature) continue;
    if (await timingSafeEqual(expectedStr, providedSignature)) return true;
  }
  return false;
}

export function extractTokenFromAddress(address: string): string {
  if (!address) return '';
  const m = address.match(/reply\+([a-f0-9]{16,64})@/i);
  return m ? m[1] : '';
}

export function extractPlainText(text: string, html: string): string {
  if (text) {
    return decodeQuotedPrintableText(text);
  }
  if (html) {
    const withBreaks = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p[^>]*>/gi, '\n')
      .replace(/<div[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    return withBreaks.replace(/\n{3,}/g, '\n\n').trim();
  }
  return '';
}

function decodeQuotedPrintableText(s: string): string {
  if (!/=[0-9A-Fa-f]{2}/.test(s)) return s;
  try {
    return decodeURIComponent(s.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => `%${hex}`));
  } catch {
    return s.replace(/=\r?\n/g, '');
  }
}

export function extractReplyText(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const splitMarkers = [
    /^On\s+.*?wrote:.*$/im,
    /^在[^\n]*写道[：:].*$/im,
    /^发件人[：:]\s*[^\n]*$/im,
    /^发送时间[：:]\s*[^\n]*$/im,
    /^-{6,}\s*原始邮件\s*-{6,}.*$/im,
    /^-{6,}\s*$/im,
  ];
  const quoteLineRe = /^>{1,}[^>]*$/im;
  let bestIndex = text.length;
  for (const re of splitMarkers) {
    const m = re.exec(text);
    if (m && m.index > 0 && m.index < bestIndex) bestIndex = m.index;
  }
  if (bestIndex === text.length) {
    const m = quoteLineRe.exec(text);
    if (m && m.index > 0) bestIndex = m.index;
  }
  let main = bestIndex < text.length ? text.slice(0, bestIndex) : text;
  const lines = main.split('\n').filter((line) => line.trim() !== '');
  while (lines.length && /^-{3,}\s*$/.test(lines[lines.length - 1])) lines.pop();
  main = lines.map((line) => line.replace(/^>+/, '')).join('\n').trim();
  return main;
}

export async function claimWebhookEvent(db: D1Database, svixId: string): Promise<boolean> {
  await db
    .prepare("CREATE TABLE IF NOT EXISTS webhook_events (svix_id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')))")
    .run();
  const result = await db
    .prepare('INSERT OR IGNORE INTO webhook_events (svix_id) VALUES (?)')
    .bind(svixId)
    .run();
  if (result.meta.changes === 0) return false;
  await db.prepare("DELETE FROM webhook_events WHERE created_at < datetime('now', '-1 day')").run();
  return true;
}
