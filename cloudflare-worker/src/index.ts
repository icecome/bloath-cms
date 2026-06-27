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

// 认证中间件 - 直接使用 GitHub access_token
function authenticate(request: Request, _env: Env): { token: string } | Response {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { token };
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

  // 严格校验 Origin，不在白名单则返回 *（浏览器将拒绝带凭证的请求）
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Frontend-Url',
    'Access-Control-Max-Age': '86400'
  };

  // 只有当 Origin 在白名单中时才设置具体 Origin 头
  if (allowedOrigin !== '*') {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  return headers;
}

// 添加 CORS 头到响应
function addCorsHeaders(response: Response, origin: string, env: Env): Response {
  Object.entries(corsHeaders(origin, env)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

// 生成带签名的 state，编码 frontendUrl 信息
async function generateState(frontendUrl: string, env: Env): Promise<string> {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const randomPart = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const payload = `${frontendUrl}:${randomPart}`;
  // 使用 HMAC-SHA256 签名
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.FRONTEND_URL || 'fallback-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${payload}:${sigHex}`;
}

// 验证并解析 state
function parseState(state: string): { frontendUrl: string; valid: boolean } {
  const parts = state.split(':');
  if (parts.length < 3) return { frontendUrl: '', valid: false };
  // 最后部分是签名，倒数第二部分是随机值，前面是 frontendUrl
  const randomPart = parts[parts.length - 2];
  const sigHex = parts[parts.length - 1];
  const frontendUrl = parts.slice(0, -2).join(':');
  
  // 简单校验：frontendUrl 必须是合法 URL
  try {
    new URL(frontendUrl);
    return { frontendUrl, valid: true };
  } catch {
    return { frontendUrl: '', valid: false };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    // 生产环境使用当前域名，本地开发使用 localhost
    const workerUrl = url.origin.startsWith('http://localhost') 
      ? 'http://localhost:8787' 
      : url.origin;
    // 优先使用请求头中的前端地址，其次使用环境变量配置，最后默认
    const frontendUrl = request.headers.get('X-Frontend-Url') || env.FRONTEND_URL || 'http://localhost:5173';

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(origin, env)
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
        const clientId = env.GITHUB_CLIENT_ID || 'CLIENT_ID_NOT_SET';
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(workerUrl + '/api/auth/callback')}&scope=repo%20user:email&state=${state}&prompt=authorize`;
        return addCorsHeaders(Response.json({ authUrl }), origin, env);
      }

      if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code || !state) {
          return addCorsHeaders(Response.json({ error: 'Missing code or state' }, { status: 400 }), origin, env);
        }

        // 验证并解析 state
        const stateData = parseState(state);
        if (!stateData.valid) {
          return addCorsHeaders(Response.json({ error: 'Invalid state' }, { status: 400 }), origin, env);
        }

        const storedFrontendUrl = stateData.frontendUrl || frontendUrl;

        const accessToken = await exchangeCode(code, env.GITHUB_CLIENT_SECRET || 'SECRET_NOT_SET', env.GITHUB_CLIENT_ID || 'CLIENT_ID_NOT_SET', workerUrl + '/api/auth/callback');
        const user = await getUserInfo(accessToken);

        // 重定向到前端，直接传递 GitHub access_token（使用 fragment 不发送到服务器）
        const redirectUrl = `${storedFrontendUrl}/login#${encodeURIComponent(JSON.stringify({
          token: accessToken,
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
        const authResult = authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const user = await getUserInfo(authResult.token);
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
        const authResult = authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const repos = await getUserRepos(authResult.token);
        return addCorsHeaders(Response.json({
          success: true,
          data: repos.filter((repo) => repo.name !== '.github')
        }), origin, env);
      }

      if (url.pathname === '/api/repos/files' && request.method === 'GET') {
        const authResult = authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const token = authResult.token;

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

        const files = await listDir(token, owner!, repo!, path, branch);
        return addCorsHeaders(Response.json({ success: true, data: files }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'GET') {
        const authResult = authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const token = authResult.token;

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

        const file = await readFile(token, owner!, repo!, filePath, branch);
        return addCorsHeaders(Response.json({ success: true, data: file }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'PUT') {
        const authResult = authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const token = authResult.token;

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

        await writeFile(token, owner, repo, filePath, content, message, sha, branch, author);
        return addCorsHeaders(Response.json({ success: true, data: { path: filePath } }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'DELETE') {
        const authResult = authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const token = authResult.token;

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

        await deleteFile(token, owner, repo, filePath, sha, message, branch);
        return addCorsHeaders(Response.json({ success: true }), origin, env);
      }

      // 获取仓库分支列表
      if (url.pathname === '/api/repos/branches' || url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
        const authResult = authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);
        const token = authResult.token;

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

        const branches = await getRepoBranches(token, owner!, repo!);
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
