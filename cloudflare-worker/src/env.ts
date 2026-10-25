// 统一环境变量类型（Bloath 编辑器）
import type { AuthResult } from './middleware/sessionAuth';

export interface Env {
  // === GitHub 与认证 ===
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FRONTEND_URL: string;
  /** 登录白名单（逗号分隔 GitHub 用户名，大小写不敏感）。
   *  fail-closed：生产环境未配置时拒绝一切 OAuth 登录，而非放行所有人。 */
  ADMIN_GITHUB_LOGIN: string;
  ALLOWED_ORIGINS?: string;
  PROD_ORIGINS?: string;
  CONTENT_SECURITY_POLICY?: string;
  DEVICES_KV?: KVNamespace;
  /** 树缓存 KV（可选）：getTree 结果按分支 head 缓存，未绑定时优雅降级直连 */
  CACHE_KV?: KVNamespace;

  // === D1：仅缓冲层 S3 配置（app_settings 表）使用 ===
  DB: D1Database;

  // === 公共 ===
  ENVIRONMENT: string;
  CORS_ORIGIN?: string;
}

export type HonoEnv = { Bindings: Env; Variables: { auth: AuthResult } };
