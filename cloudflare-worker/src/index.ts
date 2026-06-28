// Cloudflare Worker 入口 - 路由分发和 CORS
import { exchangeCode, getUserInfo, getUserRepos, readFile, writeFile, deleteFile, listDir, getRepoBranches } from './github';
import type { ApiResponse, ContentEntry, Repo } from '../../shared/types';
import type { Env } from './github';

// 路径参数安全校验
function isValidParam(value: string | null, allowSlash = false): boolean {
  if (!value) return false;
  return allowSlash
    ? /^[a-zA-Z0-9._\/\-]+$/.test(value)
    : /^[a-zA-Z0-9._\-]+$/.test(value);
}

// JWT 工具函数（使用 Web Crypto API）
async function jwtSign(payload: Record<string, any>, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64url = (data: string) => btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const headerJson = JSON.stringify(header);
  const payloadJson = JSON.stringify(payload);
  const signingInput = `${base64url(headerJson)}.${base64url(payloadJson)}`;
  
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64url(new TextDecoder().decode(signature))}`;
}

function base64urlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(Array.from(atob(s), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

async function jwtVerify(token: string, secret: string): Promise<Record<string, any> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  try {
    const payload = JSON.parse(base64urlDecode(parts[1]));
    // 检查过期时间
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function authenticate(request: Request, env: Env): Promise<{ githubToken: string; login: string } | Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 }));
  }
  
  return jwtVerify(token, env.SESSION_SECRET).then((payload) => {
    if (!payload) {
      return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
    return { githubToken: payload.githubToken, login: payload.login };
  });
}

// CORS 头
function corsHeaders(origin: string, _env: Env): Record<string, string> {
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

  // 严格校验 Origin，不在白名单则拒绝
  if (origin && allowedOrigins.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Frontend-Url',
      'Access-Control-Max-Age': '86400'
    };
  }
  
  // 无 Origin 头或不在白名单，返回 403
  return null;
}

// 添加 CORS 头到响应
function addCorsHeaders(response: Response, origin: string, env: Env): Response {
  const headers = corsHeaders(origin, env);
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }
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
  const secretKey = env.SESSION_SECRET || 'fallback-session-secret';
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
  const secretKey = env.SESSION_SECRET || '';
  const keyBytes = encoder.encode(secretKey);
  if (!keyBytes.byteLength) {
    return { frontendUrl: '', valid: false };
  }

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
      return new Response(null, {
        headers: new Headers(corsHeaders(origin, env))
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

        const githubAccessToken = await exchangeCode(code, env.GITHUB_CLIENT_SECRET, env.GITHUB_CLIENT_ID, workerUrl + '/api/auth/callback');
        const user = await getUserInfo(githubAccessToken);

        // 生成 JWT session token（1 小时过期），不再传递 GitHub access_token
        const sessionToken = await jwtSign({
          githubToken: githubAccessToken,
          login: user.login,
          exp: Date.now() + 3600000
        }, env.SESSION_SECRET);

        // 重定向到前端，传递 session token（使用 fragment 不发送到服务器）
        const redirectUrl = `${storedFrontendUrl}/login#${encodeURIComponent(JSON.stringify({
          token: sessionToken,
          login: user.login,
          avatar: user.avatar_url,
          name: user.name || ''
        }))}`;
        return addCorsHeaders(new Response(null, {
          status: 302,
          headers: { 'Location': redirectUrl }
        }), origin, env);
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

        if (!isValidParam(owner) || !isValidParam(repo)) {
          return addCorsHeaders(Response.json({ error: 'Invalid owner or repo' }, { status: 400 }), origin, env);
        }
        if (path && !isValidParam(path, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isValidParam(branch)) {
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

        if (!isValidParam(owner) || !isValidParam(repo) || !filePath) {
          return addCorsHeaders(Response.json({ error: 'Missing required params' }, { status: 400 }), origin, env);
        }
        if (!isValidParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isValidParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        const file = await readFile(githubToken, owner!, repo!, filePath, branch);
        return addCorsHeaders(Response.json({ success: true, data: file }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'PUT') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const githubToken = authResult.githubToken;

        const data = await request.json() as Record<string, any>;
        const { owner, repo, path: filePath, content, message, sha, branch = 'main', userName } = data;

        if (!isValidParam(owner) || !isValidParam(repo) || !filePath || !content) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (!isValidParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isValidParam(branch)) {
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

        const data = await request.json() as Record<string, any>;
        const { owner, repo, path: filePath, sha, message, branch = 'main' } = data;

        if (!isValidParam(owner) || !isValidParam(repo) || !filePath || !sha) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (!isValidParam(filePath, true)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path' }, { status: 400 }), origin, env);
        }
        if (!isValidParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        await deleteFile(githubToken, owner, repo, filePath, sha, message, branch);
        return addCorsHeaders(Response.json({ success: true }), origin, env);
      }

      // 获取仓库分支列表
      if (url.pathname === '/api/repos/branches' || url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
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

        if (!isValidParam(owner) || !isValidParam(repo)) {
          return addCorsHeaders(Response.json({ error: 'Missing owner or repo' }, { status: 400 }), origin, env);
        }

        const branches = await getRepoBranches(githubToken, owner!, repo!);
        return addCorsHeaders(Response.json({ success: true, data: branches }), origin, env);
      }

      // 404
      return addCorsHeaders(Response.json({ error: 'Not found' }, { status: 404 }), origin, env);
    } catch (error) {
      console.error('Worker error:', error);
      // 生产环境不返回详细错误信息
      return addCorsHeaders(Response.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      ), origin, env);
    }
  }
}

