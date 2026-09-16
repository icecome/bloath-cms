// AES-GCM 加解密统一实现：session token 与 buffer 配置共用
// 密文格式保持 IV(12) || cipher，base64 编码，与历史落库字节兼容

async function deriveKey(secret: string, domainPrefix: string, usages: ('encrypt' | 'decrypt')[]): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${domainPrefix}${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, usages);
}

export async function sealWithSecret(secret: string, plain: string, domainPrefix = ''): Promise<string> {
  const key = await deriveKey(secret, domainPrefix, ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...combined));
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
