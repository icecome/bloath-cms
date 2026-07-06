// Cloudflare Worker 入口 - 路由分发和 CORS
import { exchangeCode, getUserInfo, getUserRepos, readFile, writeFile, deleteFile, listDir, getRepoBranches, getTree, ApiError } from './github';
import type { Env } from './github';

// 路径参数安全校验：白名单模式，仅允许字母、数字、中文、点、连字符、下划线、斜杠
function isSafePathParam(value: string | null, allowSlash = false): boolean {
  if (!value) return false;
  if (value.includes('..')) return false;
  if (value.includes('\0')) return false;
  const pattern = allowSlash ? /^[a-zA-Z0-9\u4e00-\u9fff._/\-]+$/ : /^[a-zA-Z0-9\u4e00-\u9fff._\-]+$/;
  return pattern.test(value);
}

// 安全的 JSON 解析，防止原型污染和 DoS 攻击
function safeJsonParse(text: string): Record<string, unknown> {
  // 防止超大 JSON 攻击（限制 20MB，兼容 base64 编码的大文件上传）
  if (text.length > 20 * 1024 * 1024) {
    throw new Error('JSON payload too large');
  }
  const obj = JSON.parse(text) as Record<string, unknown>;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid JSON payload');
  }
  // 使用新对象替代 delete，防止原型污染
  const safeObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      safeObj[key] = value;
    }
  }
  return safeObj;
}

// 内容大小限制 (10MB)
const MAX_CONTENT_SIZE = 10 * 1024 * 1024;

// 从 Cookie 中解析 session token
function getSessionTokenFromCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// CSRF 防护：校验自定义 header
function checkCsrf(request: Request): boolean {
  return request.headers.get('X-Requested-With') === 'XMLHttpRequest';
}

// 认证中间件 - 从 Cookie 读取 session token 并验证
async function authenticate(request: Request, env: Env): Promise<{ githubToken: string; needsRenewal: boolean } | Response> {
  if (!checkCsrf(request)) {
    return Response.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const sessionToken = getSessionTokenFromCookie(request);
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentFingerprint = await generateDeviceFingerprint(request);
  const result = await validateSessionToken(sessionToken, env, currentFingerprint);
  if (!result) {
    return Response.json({ error: 'Session expired' }, { status: 401 });
  }
  return result;
}

// 构建 Set-Cookie 头的值
function buildSessionCookie(token: string, maxAge: number, isSecure: boolean): string {
  const parts = [
    `session=${encodeURIComponent(token)}`,
    'Path=/api',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

// 辅助函数：为响应添加自动续期 Cookie
async function addSessionRenewalCookie(
  response: Response,
  authResult: { githubToken: string; needsRenewal: boolean },
  env: Env,
  isSecure: boolean,
  deviceFingerprint?: string
): Promise<Response> {
  if (authResult.needsRenewal) {
    const newToken = await generateSessionToken(authResult.githubToken, env, deviceFingerprint);
    if (typeof newToken === 'string') {
      response.headers.set('Set-Cookie', buildSessionCookie(newToken, 21600, isSecure));
    }
  }
  return response;
}

// 生成设备指纹（基于 User-Agent 和 Accept-Language）
async function generateDeviceFingerprint(request: Request): Promise<string> {
  const ua = request.headers.get('User-Agent') || '';
  const lang = request.headers.get('Accept-Language') || '';
  const data = `${ua.slice(0, 50)}|${lang}`;
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash).slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// AES-GCM 加密生成 session token
async function generateSessionToken(githubToken: string, env: Env, deviceFingerprint?: string): Promise<string | Response> {
  const expiresAt = Date.now() + 21600000; // 6 小时
  const payload = JSON.stringify({ githubToken, expiresAt, deviceFingerprint });

  const secretKey = env.SESSION_SECRET;
  if (!secretKey) {
    return Response.json({ error: 'SESSION_SECRET not configured' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  // 使用 SHA-256 哈希将任意长度密钥转换为 256 位
  const keyBytes = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(payload)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

// AES-GCM 解密验证 session token，返回验证结果和是否需要续期
function validateSessionToken(sessionToken: string, env: Env, currentFingerprint?: string): Promise<{ githubToken: string; needsRenewal: boolean } | null> {
  return (async () => {
    try {
      const secretKey = env.SESSION_SECRET;
      if (!secretKey) return null;

      const combined = Uint8Array.from(atob(sessionToken), c => c.charCodeAt(0));
      if (combined.length < 12) return null;

      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      const encoder = new TextEncoder();
      // 使用 SHA-256 哈希将任意长度密钥转换为 256 位
      const keyBytes = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
      const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );

      const payload = JSON.parse(new TextDecoder().decode(decrypted));
      if (!payload.githubToken || !payload.expiresAt) return null;
      if (Date.now() > payload.expiresAt) return null;

      // 验证设备指纹
      if (payload.deviceFingerprint && currentFingerprint && payload.deviceFingerprint !== currentFingerprint) {
        return null;
      }

      // 检查是否需要续期（剩余时间 < 总时间的 50%，即 3 小时）
      const remaining = payload.expiresAt - Date.now();
      const totalDuration = 21600000; // 6 小时
      const needsRenewal = remaining < totalDuration / 2;

      return { githubToken: payload.githubToken, needsRenewal };
    } catch {
      return null;
    }
  })();
}

// CORS 头
function corsHeaders(origin: string, env: Env): Headers | null {
  // 允许的来源列表：从环境变量读取，支持自定义部署
  const envOrigins = env.ALLOWED_ORIGINS || '';
  const customOrigins = envOrigins.split(',').map(o => o.trim()).filter(Boolean);
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:5173'
  ];
  const prodOrigins = env.PROD_ORIGINS
    ? env.PROD_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  const allowedOrigins = [...defaultOrigins, ...customOrigins, ...prodOrigins];
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : null;

  if (!allowedOrigin) return null;

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-Frontend-Url');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');

  return headers;
}

// 添加安全头（CSP + 通用安全头）
function addSecurityHeaders(response: Response, env: Env): Response {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CSP 从环境变量读取，默认为编辑器适配的宽松但安全的配置
  const csp = env.CONTENT_SECURITY_POLICY || "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https://api.github.com https://github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

// 添加 CORS 头到响应
function addCorsHeaders(response: Response, origin: string, env: Env): Response {
  const cors = corsHeaders(origin, env);
  if (!cors) return response;
  cors.forEach((value, key) => {
    response.headers.set(key, value);
  });
  addSecurityHeaders(response, env);
  return response;
}

// 生成带签名的 state，编码 frontendUrl 和时间戳
// 格式：frontendUrl:randomPart:timestamp:signature
async function generateState(frontendUrl: string, env: Env): Promise<string> {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const randomPart = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const timestamp = Date.now().toString();
  const payload = `${frontendUrl}:${randomPart}:${timestamp}`;
  // 使用 HMAC-SHA256 签名，密钥使用 SESSION_SECRET
  const encoder = new TextEncoder();
  const secretKey = env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET not configured');
  // 统一密钥派生：先 SHA-256 哈希再作为密钥使用
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  const key = await crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${payload}:${sigHex}`;
}

// 验证并解析 state（带 HMAC 签名校验和时间戳验证）
// 格式：frontendUrl:randomPart:timestamp:signature
async function parseState(state: string, env: Env): Promise<{ frontendUrl: string; valid: boolean }> {
  const parts = state.split(':');
  // 新格式需要至少 4 部分：frontendUrl, randomPart, timestamp, signature
  if (parts.length < 4) return { frontendUrl: '', valid: false };
  
  const timestamp = parts[parts.length - 2];
  const sigHex = parts[parts.length - 1];
  const randomPart = parts[parts.length - 3];
  const frontendUrl = parts.slice(0, -3).join(':');

  // 校验时间戳（10分钟有效期）
  const stateTimestamp = parseInt(timestamp, 10);
  if (isNaN(stateTimestamp)) {
    return { frontendUrl: '', valid: false };
  }
  const now = Date.now();
  const STATE_EXPIRY = 10 * 60 * 1000; // 10分钟
  if (now - stateTimestamp > STATE_EXPIRY) {
    return { frontendUrl: '', valid: false };
  }

  // 校验 frontendUrl 格式
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(frontendUrl);
    // 只允许 http/https 协议
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { frontendUrl: '', valid: false };
    }
  } catch {
    return { frontendUrl: '', valid: false };
  }

  // 验证 HMAC 签名，密钥使用 SHA-256 哈希派生（与 generateState 保持一致）
  const encoder = new TextEncoder();
  const payload = `${frontendUrl}:${randomPart}:${timestamp}`;
  const secretKey = env.SESSION_SECRET;
  if (!secretKey) {
    return { frontendUrl: '', valid: false };
  }
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));

  try {
    const key = await crypto.subtle.importKey('raw', keyHash, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = hexToUint8Array(sigHex);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
    return { frontendUrl, valid };
  } catch {
    return { frontendUrl: '', valid: false };
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >> 1] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    // 生产环境使用当前域名，本地开发使用 localhost
    const workerUrl = url.origin.startsWith('http://localhost') 
      ? 'http://localhost:8787' 
      : url.origin;
    // 优先使用请求头中的前端地址，其次使用环境变量配置，最后默认
    const frontendUrl = request.headers.get('X-Frontend-Url') || env.FRONTEND_URL || 'http://localhost:5173';

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      const cors = corsHeaders(origin, env);
      if (!cors) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    try {
      // 非 API 请求：重定向到前端 Pages 站点
      if (!url.pathname.startsWith('/api/')) {
        return Response.redirect(frontendUrl + url.pathname + url.search, 301);
      }

      const isSecure = url.protocol === 'https:';

      // API 请求路由分发
      if (url.pathname === '/api/auth/login' && request.method === 'GET') {
        const state = await generateState(frontendUrl, env);
        const clientId = env.GITHUB_CLIENT_ID;
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(workerUrl + '/api/auth/callback')}&scope=repo%20user:email&state=${state}&prompt=consent`;
        return addCorsHeaders(Response.json({ authUrl }), origin, env);
      }

      if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code || !state) {
          return Response.redirect(`${frontendUrl}/login?error=invalid_request`, 302);
        }

        // 验证 state 签名
        const stateData = await parseState(state, env);
        if (!stateData.valid) {
          return Response.redirect(`${frontendUrl}/login?error=invalid_state`, 302);
        }

        const storedFrontendUrl = stateData.frontendUrl || frontendUrl;

        // 在后端完成 code 交换
        const accessToken = await exchangeCode(code, env.GITHUB_CLIENT_SECRET, env.GITHUB_CLIENT_ID, workerUrl + '/api/auth/callback');
        const user = await getUserInfo(accessToken);

        // 生成设备指纹并绑定到 session token
        const deviceFingerprint = await generateDeviceFingerprint(request);
        const sessionTokenResult = await generateSessionToken(accessToken, env, deviceFingerprint);
        if (sessionTokenResult instanceof Response) {
          return Response.redirect(`${frontendUrl}/login?error=server_error`, 302);
        }

        // 设置 HttpOnly Cookie 并重定向到首页
        const response = new Response(null, {
          status: 302,
          headers: {
            'Location': storedFrontendUrl + '/'
          }
        });
        response.headers.set('Set-Cookie', buildSessionCookie(sessionTokenResult, 21600, isSecure));
        return addSecurityHeaders(response, env);
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        // 清除 session cookie
        const response = Response.json({ success: true });
        const clearCookie = buildSessionCookie('', 0, isSecure);
        response.headers.set('Set-Cookie', clearCookie);
        return addCorsHeaders(response, origin, env);
      }

      if (url.pathname === '/api/me' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const user = await getUserInfo(authResult.githubToken);
        const response = Response.json({
          success: true,
          user: {
            login: user.login,
            avatar_url: user.avatar_url,
            name: user.name
          }
        });
        const deviceFingerprint = await generateDeviceFingerprint(request);
        return addCorsHeaders(await addSessionRenewalCookie(response, authResult, env, isSecure, deviceFingerprint), origin, env);
      }

      if (url.pathname === '/api/repos' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const repos = await getUserRepos(authResult.githubToken);
        return addCorsHeaders(Response.json({
          success: true,
          data: repos.filter((repo) => repo.name !== '.github')
        }), origin, env);
      }

      if (url.pathname === '/api/repos/files' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        const params = new URL(request.url).searchParams;
        const owner = params.get('owner');
        const repo = params.get('repo');
        const path = params.get('path') || '';
        const branch = params.get('branch') || 'main';

        if (!isSafePathParam(owner) || !isSafePathParam(repo)) {
          return addCorsHeaders(Response.json({ error: 'Invalid owner or repo' }, { status: 400 }), origin, env);
        }
        if (path && !isSafePathParam(path, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        const files = await listDir(githubToken, owner!, repo!, path, branch);
        return addCorsHeaders(Response.json({ success: true, data: files }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        const params = new URL(request.url).searchParams;
        const owner = params.get('owner');
        const repo = params.get('repo');
        const filePath = params.get('path');
        const branch = params.get('branch') || 'main';

        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath) {
          return addCorsHeaders(Response.json({ error: 'Missing required params' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        const file = await readFile(githubToken, owner!, repo!, filePath, branch);
        return addCorsHeaders(Response.json({ success: true, data: file }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'PUT') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        const data = safeJsonParse(await request.text()) as Record<string, any>;
        const { owner, repo, path: filePath, content, base64Content, message, sha, branch = 'main', userName } = data;

        // 支持 content（文本）或 base64Content（图片等二进制）
        const fileContent = base64Content || content;
        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !fileContent) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (typeof fileContent === 'string') {
          // base64Content 编码后膨胀约 33%，实际可上传二进制内容约 7.5MB
          if (fileContent.length > MAX_CONTENT_SIZE) {
            return addCorsHeaders(Response.json({ error: 'File too large (max 10MB encoded)' }, { status: 400 }), origin, env);
          }
        }
        if (!isSafePathParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        // 构建 author 信息：用户名 + 来自 BloathCMS
        let author: { name: string; email: string } | undefined;
        if (userName && /^[a-zA-Z0-9_-]+$/.test(userName)) {
          author = { name: `${userName} 来自 BloathCMS`, email: `${userName}@bloath.cms` };
        }

        // 如果传入的是 base64Content，直接传给 writeFile（跳过内部 base64 编码）
        await writeFile(githubToken, owner, repo, filePath, fileContent, message, sha, branch, author, !!base64Content);
        return addCorsHeaders(Response.json({ success: true, data: { path: filePath } }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'DELETE') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        const data = safeJsonParse(await request.text()) as Record<string, any>;
        const { owner, repo, path: filePath, sha, message, branch = 'main', userName } = data;

        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !sha) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        // 构建 author 信息
        let author: { name: string; email: string } | undefined;
        if (userName && /^[a-zA-Z0-9_-]+$/.test(userName)) {
          author = { name: `${userName} 来自 BloathCMS`, email: `${userName}@bloath.cms` };
        }

        await deleteFile(githubToken, owner, repo, filePath, sha, message, branch, author);
        return addCorsHeaders(Response.json({ success: true }), origin, env);
      }

      // 获取仓库分支列表
      if (url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        let owner = url.searchParams.get('owner');
        let repo = url.searchParams.get('repo');

        // 支持从路径中提取 owner 和 repo
        if (url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
          const parts = url.pathname.replace('/api/repos/', '').replace('/branches', '').split('/');
          owner = owner || parts[0] || null;
          repo = repo || parts[1] || null;
        }

        if (!isSafePathParam(owner) || !isSafePathParam(repo)) {
          return addCorsHeaders(Response.json({ error: 'Missing owner or repo' }, { status: 400 }), origin, env);
        }

        const branches = await getRepoBranches(githubToken, owner!, repo!);
        return addCorsHeaders(Response.json({ success: true, data: branches }), origin, env);
      }

      // 获取仓库目录树（替代递归扫描）
      if (url.pathname === '/api/repos/tree' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        const params = new URL(request.url).searchParams;
        const owner = params.get('owner');
        const repo = params.get('repo');
        const branch = params.get('branch') || 'main';

        if (!isSafePathParam(owner) || !isSafePathParam(repo)) {
          return addCorsHeaders(Response.json({ error: 'Missing owner or repo' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        const mode = (params.get('mode') || 'commits') as 'commits' | 'filename';

        const tree = await getTree(githubToken, owner!, repo!, branch, mode);
        return addCorsHeaders(Response.json({ success: true, data: tree }), origin, env);
      }

      // 404
      return addCorsHeaders(Response.json({ error: 'Not found' }, { status: 404 }), origin, env);
    } catch (error) {
      console.error('Worker error:', error);
      if (error instanceof ApiError) {
        return addCorsHeaders(Response.json(
          { success: false, error: error.message },
          { status: error.statusCode }
        ), origin, env);
      }
      // 生产环境不暴露详细错误信息
      return addCorsHeaders(Response.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      ), origin, env);
    }
  }
}

