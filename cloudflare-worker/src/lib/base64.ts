// 二进制 → base64（Workers 无 Buffer）。
//
// 不用 String.fromCharCode(...bytes) 的一次性展开：大文件（25 MB）会超出
// 引擎的实参上限而抛 RangeError；分块累加规避该限制，同时避免中间数组膨胀。

const CHUNK = 0x8000; // 32KB：兼顾 btoa 单次处理成本与内存峰值

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}
