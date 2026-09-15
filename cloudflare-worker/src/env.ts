// 统一环境变量类型（Bloath 编辑器 + 留言模块）
export interface Env {
  // === Bloath 编辑器（GitHub）===
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FRONTEND_URL: string;
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

export type HonoEnv = { Bindings: Env; Variables: { auth: unknown } };
