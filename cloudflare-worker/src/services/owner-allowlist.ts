// 所有者白名单（fail-closed）：判断 OAuth 登录身份是否允许获得会话。
//
// 背景：留言管理模块下线时，requireAdminAuth（唯一身份闸门）被一并删除，
// /api/auth/callback 曾对任何完成 OAuth 的 GitHub 账号签发会话。缓冲层 S3 配置
// 与命名空间是部署者全局资源（D1 app_settings 单份配置），单人使用姿态下
// 必须把会话签发限制在白名单账号内。
//
// 抽成零依赖模块：可被 node --experimental-strip-types 单测直接锁定
// （同 publish-paths.ts 模式，见该文件头注释）。

export interface AllowlistEnvLike {
  ADMIN_GITHUB_LOGIN?: string;
  ENVIRONMENT: string;
}

/** 解析逗号分隔白名单；统一小写、去空项 */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 登录身份是否允许获得会话。
 *
 * fail-closed 语义：
 * - 白名单已配置：仅名单内账号（大小写不敏感）放行；
 * - 白名单未配置：生产环境拒绝所有 OAuth 登录（绝不能「未配置即全开」）；
 *   非生产环境放行（本地开发依赖 dev-login 与随意账号调试，dev-login 另有
 *   ENVIRONMENT 双重守卫，见 routes/auth.ts）。
 */
export function isLoginAllowed(login: string, env: AllowlistEnvLike): boolean {
  const allowlist = parseAllowlist(env.ADMIN_GITHUB_LOGIN);
  if (allowlist.length === 0) return env.ENVIRONMENT !== 'production';
  return allowlist.includes(login.trim().toLowerCase());
}
