// Cloudflare Worker 入口 - 路由分发和 CORS
import { exchangeCode, getUserInfo, getUserRepos, readFile, writeFile, deleteFile, listDir, getRepoBranches } from './github';
import type { ApiResponse, ContentEntry } from '../shared/types';
import type { Env } from './github';

// Session 管理 - 使用内存 Map + TTL 清理（兼容本地开发和生产环境）
const SESSION_TTL = 86400; // 24 小时

// 模块级存储
const sessions = new Map<string, { token: string; createdAt: number }>();
const states = new Map<string, { frontendUrl: string; createdAt: number }>();

function storeState(state: string, frontendUrl: string): void {
  states.set(state, { frontendUrl, createdAt: Date.now() });
}

function consumeState(state: string): { frontendUrl: string } | null {
  const data = states.get(state);
  if (!data) return null;
  states.delete(state); // 一次性消费
  return data;
}

class SessionManager {
  async setSession(token: string, sessionKey: string): Promise<void> {
    sessions.set(sessionKey, {
      token,
      createdAt: Date.now()
    });
  }

  async getSession(sessionKey: string): Promise<{ token: string; createdAt: number } | null> {
    return sessions.get(sessionKey) || null;
  }

  async deleteSession(sessionKey: string): Promise<void> {
    sessions.delete(sessionKey);
  }

  // 清理过期 session（在每次请求时调用）
  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of sessions) {
      if (now - value.createdAt > SESSION_TTL * 1000) {
        sessions.delete(key);
      }
    }
  }
}

const sessionManager = new SessionManager();

// CORS 头
function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowedOrigins = [
    env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:5173'
  ];

  // 如果请求的 Origin 在允许列表中，返回该 Origin；否则返回 *
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : '*';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Frontend-Url',
    'Access-Control-Max-Age': '86400'
  };
}

// 添加 CORS 头到响应
function addCorsHeaders(response: Response, origin: string, env: Env): Response {
  Object.entries(corsHeaders(origin, env)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

// 生成随机 state
function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const workerUrl = env.CF_WORKER_URL || 'http://localhost:8787';
    // 优先使用请求头中的前端地址，其次使用配置，最后默认
    const frontendUrl = request.headers.get('X-Frontend-Url') || env.FRONTEND_URL || 'http://localhost:3000';

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(origin, env)
      });
    }

    try {
      // 清理过期 session
      sessionManager.cleanup();

      // 非 API 请求：尝试从静态资源服务
      if (!url.pathname.startsWith('/api/')) {
        // 尝试从 ASSETS 获取静态文件
        try {
          const assetResponse = await env.ASSETS?.fetch(request);
          if (assetResponse && assetResponse.status === 200) {
            return assetResponse;
          }
        } catch {}
        // 静态文件不存在，返回 index.html（SPA 路由）
        try {
          const indexResponse = await env.ASSETS?.fetch(`${url.origin}/index.html`);
          if (indexResponse && indexResponse.status === 200) {
            return indexResponse;
          }
        } catch {}
        return addCorsHeaders(Response.json({ error: 'Not found' }, { status: 404 }), origin, env);
      }

      // API 请求路由分发
      if (url.pathname === '/api/auth/login' && request.method === 'GET') {
        const state = generateState();
        // 存储 state 到内存 Map
        storeState(state, frontendUrl);
        // redirect_uri 指向 Worker，Worker 处理完回调后重定向到前端
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(workerUrl + '/api/auth/callback')}&scope=repo%20user:email&state=${state}&prompt=authorize`;
        return addCorsHeaders(Response.json({ authUrl }), origin, env);
      }

      if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code || !state) {
          return addCorsHeaders(Response.json({ error: 'Missing code or state' }, { status: 400 }), origin, env);
        }

        // 验证 state（一次性消费）
        const stateData = consumeState(state);
        if (!stateData) {
          return addCorsHeaders(Response.json({ error: 'Invalid state' }, { status: 400 }), origin, env);
        }

        const storedFrontendUrl = stateData.frontendUrl || frontendUrl;

        const accessToken = await exchangeCode(code, env.GITHUB_CLIENT_SECRET, env.GITHUB_CLIENT_ID, workerUrl + '/api/auth/callback');
        const user = await getUserInfo(accessToken);

        // 生成 session key
        const sessionKey = Math.random().toString(36).substring(2);
        await sessionManager.setSession(accessToken, sessionKey);

        // 重定向到前端，使用 fragment 传递 sessionKey（不发送到服务器，不被日志记录）
        const redirectUrl = `${storedFrontendUrl}/login#${encodeURIComponent(JSON.stringify({
          token: sessionKey,
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
        const sessionKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const user = await getUserInfo(session.token);
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
        const sessionKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const repos = await getUserRepos(session.token);
        return addCorsHeaders(Response.json({
          success: true,
          data: repos.filter((repo) => repo.name !== '.github')
        }), origin, env);
      }

      if (url.pathname === '/api/repos/files' && request.method === 'GET') {
        const sessionKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const token = session.token;

        const params = new URL(request.url).searchParams;
        const owner = params.get('owner');
        const repo = params.get('repo');
        const path = params.get('path') || '';
        const branch = params.get('branch') || 'main';

        if (!owner || !repo) {
          return addCorsHeaders(Response.json({ error: 'Missing owner or repo' }, { status: 400 }), origin, env);
        }

        const files = await listDir(token, owner, repo, path, branch);
        return addCorsHeaders(Response.json({ success: true, data: files }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'GET') {
        const sessionKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const token = session.token;

        const params = new URL(request.url).searchParams;
        const owner = params.get('owner');
        const repo = params.get('repo');
        const path = params.get('path');
        const branch = params.get('branch') || 'main';

        if (!owner || !repo || !path) {
          return addCorsHeaders(Response.json({ error: 'Missing required params' }, { status: 400 }), origin, env);
        }

        const file = await readFile(token, owner, repo, path, branch);
        return addCorsHeaders(Response.json({ success: true, data: file }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'PUT') {
        const sessionKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const token = session.token;

        const data = await request.json();
        const { owner, repo, path: filePath, content, message, sha, branch = 'main', author } = data;

        if (!owner || !repo || !filePath || !content) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }

        await writeFile(token, owner, repo, filePath, content, message, sha, branch, author);
        return addCorsHeaders(Response.json({ success: true, data: { path: filePath } }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'DELETE') {
        const sessionKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const token = session.token;

        const data = await request.json();
        const { owner, repo, path: filePath, sha, message, branch = 'main' } = data;

        if (!owner || !repo || !filePath || !sha) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }

        await deleteFile(token, owner, repo, filePath, sha, message, branch);
        return addCorsHeaders(Response.json({ success: true }), origin, env);
      }

      // 获取仓库分支列表 - 支持 /api/repos/branches 和 /api/repos/:owner/:repo/branches
      if (url.pathname === '/api/repos/branches' || url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
        const sessionKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }), origin, env);
        }
        const token = session.token;

        let owner = url.searchParams.get('owner');
        let repo = url.searchParams.get('repo');

        // 支持从路径中提取 owner 和 repo
        if (url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
          const parts = url.pathname.replace('/api/repos/', '').replace('/branches', '').split('/');
          owner = owner || parts[0] || null;
          repo = repo || parts[1] || null;
        }

        if (!owner || !repo) {
          return addCorsHeaders(Response.json({ error: 'Missing owner or repo' }, { status: 400 }), origin, env);
        }

        const branches = await getRepoBranches(token, owner, repo);
        return addCorsHeaders(Response.json({ success: true, data: branches }), origin, env);
      }

      // 404
      return addCorsHeaders(Response.json({ error: 'Not found' }, { status: 404 }), origin, env);
    } catch (error) {
      console.error('Worker error:', error);
      return addCorsHeaders(Response.json(
        { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      ), origin, env);
    }
  }
}
