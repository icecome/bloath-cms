import { decodeBase64, encodeBase64 } from 'hono/utils/encode';

export function bytesToBase64(data: Uint8Array): string {
  return encodeBase64(data as unknown as ArrayBuffer);
}

export function base64ToBytes(str: string): Uint8Array {
  return decodeBase64(str);
}
