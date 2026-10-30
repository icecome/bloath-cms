// S3 后端 id 白名单校验（零依赖纯函数模块，供 node 原生测试链路直接加载）。
//
// 为什么独立：mediaS3Config.service.ts 导入 crypto/settings.service（D1/Workers 类型与
// 运行时依赖），node --experimental-strip-types 测试链路无法加载整个服务文件。
// backendId 校验逻辑独立出来即可测，与 buffer 的 owner-allowlist.ts 同范式。
//
// 共享表防注入：backendId 作为 app_settings 分键后缀，必须限定在 [a-zA-Z0-9_-] 白名单
// 且 ≤64 字符，否则攻击者可经 query/body 注入任意键名读写共享表。

/** 缺省 backend id：与前端 configSchema 的 DEFAULT_BACKEND_ID 保持一致 */
export const DEFAULT_BACKEND_ID = 'default';

/** backendId 白名单：防止经 query/body 注入任意 app_settings 键 */
const BACKEND_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** 校验并归一 backendId；非法返回 null（调用方按 400 处理） */
export function normalizeBackendId(raw: string | undefined | null): string | null {
  const id = (raw || '').trim();
  if (!id) return DEFAULT_BACKEND_ID;
  return BACKEND_ID_RE.test(id) ? id : null;
}
