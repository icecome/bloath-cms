// 统一环境变量类型（Bloath 编辑器 + 留言模块）
import type { AuthResult } from './middleware/sessionAuth';

export interface Env {
  // === Bloath 编辑器（GitHub）===
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FRONTEND_URL: string;
  /**
   * 管理员 GitHub 用户名白名单（逗号分隔，大小写不敏感）。
   * 未配置时管理接口一律拒绝访问，避免"忘记配置即全开"的失效模式。
   */
  ADMIN_GITHUB_LOGIN?: string;
  ALLOWED_ORIGINS?: string;
  PROD_ORIGINS?: string;
  CONTENT_SECURITY_POLICY?: string;
  DEVICES_KV?: KVNamespace;

  // === 留言模块 ===
  DB: D1Database;
  RESEND_API_KEY: string;
  RESEND_FROM?: string;
  VECTREL_TOKEN?: string;
  VECTREL_API_URL?: string;
  PUSH_SERVICE?: Fetcher;
  TURNSTILE_SECRET_KEY: string;
  BLOGGER_EMAIL: string;
  RESEND_WEBHOOK_SECRET: string;

  // === 公共 ===
  ENVIRONMENT: string;
  CORS_ORIGIN?: string;
  INBOUND_REPLY_DOMAIN: string;
}

export type HonoEnv = { Bindings: Env; Variables: { auth: AuthResult } };
