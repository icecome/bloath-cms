// 兼容桶：具体实现已拆至 pathGuard / cors / sessionAuth
export {
  isSafePathParam, safeJsonParse, MAX_CONTENT_SIZE,
} from './pathGuard';
export {
  getAllowedOrigins, isAllowedFrontendUrl, corsHeaders,
  addSecurityHeaders, addCorsHeaders, corsMiddleware,
} from './cors';
export {
  checkCsrf, getSessionTokenFromCookie, buildSessionCookie,
  authenticate, requireAuth, requireAdminAuth, addSessionRenewalCookie,
  requestLog,
  type AuthResult,
} from './sessionAuth';
