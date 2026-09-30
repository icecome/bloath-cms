// AES-GCM 加解密统一实现：session token 与 buffer 配置共用
// 密文格式保持 IV(12) || cipher，base64 编码，与历史存储字节兼容

async function deriveKey(secret: string, domainPrefix: string, usages: ('encrypt' | 'decrypt')[]): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${domainPrefix}${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, usages);
}

/**
 * 字节数组转 base64。
 * 不用 String.fromCharCode(...bytes) 展开写法：参数数量受栈限制（约 65k），
 * 虽然当前调用面远小于该量级，逐段转换可避免将来扩大输入时的隐性崩溃。
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function sealWithSecret(secret: string, plain: string, domainPrefix = ''): Promise<string> {
  const key = await deriveKey(secret, domainPrefix, ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(combined);
}

export async function openWithSecret(secret: string, encoded: string, domainPrefix = ''): Promise<string> {
  const key = await deriveKey(secret, domainPrefix, ['decrypt']);
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (combined.length < 13) throw new Error('invalid ciphertext');
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}
