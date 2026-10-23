// 统一环境变量类型（Bloath 编辑器）
import type { AuthResult } from './middleware/sessionAuth';

export interface Env {
  // === GitHub 与认证 ===
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FRONTEND_URL: string;
  ALLOWED_ORIGINS?: string;
  PROD_ORIGINS?: string;
  CONTENT_SECURITY_POLICY?: string;
  DEVICES_KV?: KVNamespace;

  // === D1：仅缓冲层 S3 配置（app_settings 表）使用 ===
  DB: D1Database;

  // === 公共 ===
  ENVIRONMENT: string;
  CORS_ORIGIN?: string;
}

export type HonoEnv = { Bindings: Env; Variables: { auth: AuthResult } };
