// Cloudflare Worker 入口 - 路由分发和 CORS
import { exchangeCode, getUserInfo, getUserRepos, readFile, writeFile, deleteFile, listDir, getRepoBranches, getTree } from './github';
import type { ApiResponse, ContentEntry, Repo } from '../../shared/types';
import type { Env } from './github';

// 路径参数安全校验
function isSafePathParam(value: string | null, allowSlash = false): boolean {
  if (!value) return false;
  const dangerous = /[<>"'`;&|\\$(){}[\]!#%]/;
  if (dangerous.test(value)) return false;
  return allowSlash
    ? /^[a-zA-Z0-9._\/\-\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s]+$/.test(value)
    : /^[a-zA-Z0-9._\-\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s]+$/.test(value);
}

// 安全的 JSON 解析，防止原型污染
function safeJsonParse(text: string): Record<string, unknown> {
  const obj = JSON.parse(text) as Record<string, unknown>;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid JSON payload');
  }
  delete (obj as any).__proto__;
  delete (obj as any).constructor;
  delete (obj as any).prototype;
  return obj;
}

// 内容大小限制 (10MB)
const MAX_CONTENT_SIZE = 10 * 1024 * 1024;

// 认证中间件 - 验证 session token 并返回 GitHub access_token
async function authenticate(request: Request, env: Env): Promise<{ githubToken: string } | Response> {
  const sessionToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await validateSessionToken(sessionToken, env);
  if (!result) {
    return Response.json({ error: 'Session expired' }, { status: 401 });
  }
  return result;
}

// AES-GCM 加密生成 session token
async function generateSessionToken(githubToken: string, env: Env): Promise<string | Response> {
  const expiresAt = Date.now() + 3600000;
  const payload = JSON.stringify({ githubToken, expiresAt });

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

// AES-GCM 解密验证 session token
function validateSessionToken(sessionToken: string, env: Env): Promise<{ githubToken: string } | null> {
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

      return { githubToken: payload.githubToken };
    } catch {
      return null;
    }
  })();
}

// CORS 头
function corsHeaders(origin: string, _env: Env): Headers | null {
  // 开发环境
  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:5173'
  ];
  // 生产环境 Pages 域名
  const prodOrigins = [
    'https://bloath-cms-web.pages.dev',
    'https://bloath.icecome.com',
    'https://bloath-cms.pages.dev',
    'https://bloath-cms.icecome.workers.dev',
    'https://bloath-cms-worker.api.icecome.com'
  ];

  const allowedOrigins = [...devOrigins, ...prodOrigins];
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : null;

  if (!allowedOrigin) return null;

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Frontend-Url');
  headers.set('Access-Control-Max-Age', '86400');

  return headers;
}

// 添加 CORS 头到响应
function addCorsHeaders(response: Response, origin: string, env: Env): Response {
  const cors = corsHeaders(origin, env);
  if (!cors) return response;
  cors.forEach((value, key) => {
    response.headers.set(key, value);
  });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

// 生成带签名的 state，编码 frontendUrl 信息
async function generateState(frontendUrl: string, env: Env): Promise<string> {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const randomPart = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const payload = `${frontendUrl}:${randomPart}`;
  // 使用 HMAC-SHA256 签名，密钥使用 SESSION_SECRET
  const encoder = new TextEncoder();
  const secretKey = env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${payload}:${sigHex}`;
}

// 验证并解析 state（带 HMAC 签名校验）
async function parseState(state: string, env: Env): Promise<{ frontendUrl: string; valid: boolean }> {
  const parts = state.split(':');
  if (parts.length < 3) return { frontendUrl: '', valid: false };
  const randomPart = parts[parts.length - 2];
  const sigHex = parts[parts.length - 1];
  const frontendUrl = parts.slice(0, -2).join(':');

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

  // 验证 HMAC 签名，密钥使用 SESSION_SECRET
  const encoder = new TextEncoder();
  const payload = `${frontendUrl}:${randomPart}`;
  const secretKey = env.SESSION_SECRET;
  if (!secretKey) {
    return { frontendUrl: '', valid: false };
  }
  const keyBytes = encoder.encode(secretKey);

  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
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
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
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
      console.log('[cors] OPTIONS request, origin:', origin);
      const cors = corsHeaders(origin, env);
      console.log('[cors] corsHeaders result:', cors ? 'found' : 'null');
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
          return addCorsHeaders(Response.json({ error: 'Missing code or state' }, { status: 400 }), origin, env);
        }

        // 验证并解析 state（带 HMAC 签名校验）
        const stateData = await parseState(state, env);
        if (!stateData.valid) {
          return addCorsHeaders(Response.json({ error: 'Invalid state' }, { status: 400 }), origin, env);
        }

        const storedFrontendUrl = stateData.frontendUrl || frontendUrl;

        const accessToken = await exchangeCode(code, env.GITHUB_CLIENT_SECRET, env.GITHUB_CLIENT_ID, workerUrl + '/api/auth/callback');
        const user = await getUserInfo(accessToken);

        // AES-GCM 加密生成 session token
        const sessionTokenResult = await generateSessionToken(accessToken, env);
        if (sessionTokenResult instanceof Response) {
          return addCorsHeaders(sessionTokenResult, origin, env);
        }
        const sessionToken = sessionTokenResult;

        // 重定向到前端，通过 query 参数传递 session token 和用户信息
        const redirectUrl = `${storedFrontendUrl}/login?token=${encodeURIComponent(sessionToken)}&login=${encodeURIComponent(user.login || '')}&avatar=${encodeURIComponent(user.avatar_url || '')}&name=${encodeURIComponent(user.name || '')}`;
        return addCorsHeaders(new Response(null, {
          status: 302,
          headers: { 'Location': redirectUrl }
        }), origin, env);
      }

      // 前端 GitHub 回调回来后，调用此端点完成登录
      if (url.pathname === '/api/auth/complete' && request.method === 'POST') {
        try {
          const body = await request.json() as { accessToken: string };
          if (!body.accessToken) {
            return addCorsHeaders(Response.json({ error: 'Missing access token' }, { status: 400 }), origin, env);
          }
          const sessionTokenResult = await generateSessionToken(body.accessToken, env);
          if (sessionTokenResult instanceof Response) {
            return addCorsHeaders(sessionTokenResult, origin, env);
          }
          return addCorsHeaders(Response.json({ success: true, sessionToken: sessionTokenResult }), origin, env);
        } catch {
          return addCorsHeaders(Response.json({ error: 'Invalid request body' }, { status: 400 }), origin, env);
        }
      }

      if (url.pathname === '/api/me' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const user = await getUserInfo(authResult.githubToken);
        return addCorsHeaders(Response.json({
          success: true,
          user: {
            login: user.login,
            avatar_url: user.avatar_url,
            name: user.name
          }
        }), origin, env);
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
        const { owner, repo, path: filePath, content, message, sha, branch = 'main', userName } = data;

        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !content) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (typeof content === 'string' && content.length > MAX_CONTENT_SIZE) {
          return addCorsHeaders(Response.json({ error: 'File too large (max 10MB)' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        // 构建 author 信息：用户名 + 来自 BloathCMS
        let author: { name: string; email: string } | undefined;
        if (userName) {
          author = { name: `${userName} 来自 BloathCMS`, email: `${userName}@bloath.cms` };
        }

        await writeFile(githubToken, owner, repo, filePath, content, message, sha, branch, author);
        return addCorsHeaders(Response.json({ success: true, data: { path: filePath } }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'DELETE') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        const data = safeJsonParse(await request.text()) as Record<string, any>;
        const { owner, repo, path: filePath, sha, message, branch = 'main' } = data;

        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !sha) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        await deleteFile(githubToken, owner, repo, filePath, sha, message, branch);
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

        const tree = await getTree(githubToken, owner!, repo!, branch);
        return addCorsHeaders(Response.json({ success: true, data: tree }), origin, env);
      }

      // 404
      return addCorsHeaders(Response.json({ error: 'Not found' }, { status: 404 }), origin, env);
    } catch (error) {
      console.error('Worker error:', error);
      // 临时调试
      const msg = error instanceof Error ? error.message : String(error);
      return addCorsHeaders(Response.json(
        { success: false, error: msg },
        { status: 500 }
      ), origin, env);
    }
  }
}

