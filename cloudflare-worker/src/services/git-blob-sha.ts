// Git blob sha 计算（零依赖，可被 node strip-types 单测直接锁定）。
//
// 用途：缓冲层 write 条目在写入时记录内容的 blob sha，发布编排器据此做
// 幂等预检——远端同路径内容的 sha 一致时跳过，避免「commit 成功但缓冲清理
// 失败 → 下次发布重推同内容 → 每次重试都触发 CI 部署」的部署风暴（P1-006）。
//
// Git blob sha 算法：sha1("blob {byteLength}\0{content}")。

export interface Sha1Like {
  digest(algorithm: 'SHA-1', data: Uint8Array): Promise<ArrayBuffer>;
}

/** 计算 Git blob sha（40 位小写十六进制）；subtle 参数便于测试注入 */
export async function gitBlobSha(content: string, subtle?: Sha1Like): Promise<string> {
  // workers-types 与 node types 的 globalThis.crypto 声明可能互相遮蔽，且 node
  // 测试环境无 self：双环境兼容取法（运行时同一对象，行为一致）
  const scope = globalThis as unknown as { crypto?: { subtle: Sha1Like } };
  const engine = subtle ?? scope.crypto?.subtle;
  if (!engine) throw new Error('WebCrypto subtle 不可用，无法计算 blob sha');

  // 长度必须是 UTF-8 字节数（git 语义），不是 JS 字符串长度（UTF-16 码元数）：
  // '中' 按字符数得 blob 1\0，git 得 blob 3\0，sha 必然不一致
  const body = new TextEncoder().encode(content);
  const prefix = new TextEncoder().encode(`blob ${body.length}\0`);
  const data = new Uint8Array(prefix.length + body.length);
  data.set(prefix, 0);
  data.set(body, prefix.length);

  const digest = await engine.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
