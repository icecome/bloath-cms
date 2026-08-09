// Cloudflare Worker 入口 - 路由分发
import { exchangeCode, getUserInfo, getUserRepos, readFile, writeFile, deleteFile, listDir, getRepoBranches, getTree, createBranch, ApiError } from './github';
import type { Env } from './github';
import { generateState, parseState, generateDeviceFingerprint, generateSessionToken } from './session';
import {
  isSafePathParam, safeJsonParse, MAX_CONTENT_SIZE, checkCsrf, authenticate,
  buildSessionCookie, addSessionRenewalCookie, isAllowedFrontendUrl,
  corsHeaders, addSecurityHeaders, addCorsHeaders
} from './middleware';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const workerUrl = url.origin.startsWith('http://localhost')
      ? 'http://localhost:8787'
      : url.origin;
    const headerFrontendUrl = request.headers.get('X-Frontend-Url');
    const frontendUrl = (headerFrontendUrl && isAllowedFrontendUrl(headerFrontendUrl, env))
      ? headerFrontendUrl
      : (env.FRONTEND_URL || 'http://localhost:5173');

    // CORS 预检
    if (request.method === 'OPTIONS') {
      const cors = corsHeaders(origin, env);
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // 非 API 请求：重定向到前端
      if (!url.pathname.startsWith('/api/')) {
        return Response.redirect(frontendUrl + url.pathname + url.search, 301);
      }

      const isSecure = url.protocol === 'https:';

      // === 认证路由 ===
      if (url.pathname === '/api/auth/login' && request.method === 'GET') {
        const state = await generateState(frontendUrl, env);
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(workerUrl + '/api/auth/callback')}&scope=repo%20user:email&state=${state}&prompt=consent`;
        return addCorsHeaders(Response.json({ authUrl }), origin, env);
      }

      if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          return Response.redirect(`${frontendUrl}/login?error=invalid_request`, 302);
        }

        const stateData = await parseState(state, env);
        if (!stateData.valid) {
          return Response.redirect(`${frontendUrl}/login?error=invalid_state`, 302);
        }

        const storedFrontendUrl = stateData.frontendUrl || frontendUrl;
        const accessToken = await exchangeCode(code, env.GITHUB_CLIENT_SECRET, env.GITHUB_CLIENT_ID, workerUrl + '/api/auth/callback');
        const deviceFingerprint = await generateDeviceFingerprint(request);
        const sessionTokenResult = await generateSessionToken(accessToken, env, deviceFingerprint);
        if (sessionTokenResult instanceof Response) {
          return Response.redirect(`${frontendUrl}/login?error=server_error`, 302);
        }

        const response = new Response(null, {
          status: 302,
          headers: { 'Location': storedFrontendUrl + '/' }
        });
        response.headers.set('Set-Cookie', buildSessionCookie(sessionTokenResult, 21600, isSecure));
        return addSecurityHeaders(response, env);
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        if (!checkCsrf(request, env)) {
          return addCorsHeaders(Response.json({ error: 'CSRF validation failed' }, { status: 403 }), origin, env);
        }
        const response = Response.json({ success: true });
        response.headers.set('Set-Cookie', buildSessionCookie('', 0, isSecure));
        return addCorsHeaders(response, origin, env);
      }

      if (url.pathname === '/api/me' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const user = await getUserInfo(authResult.githubToken);
        const response = Response.json({
          success: true,
          user: { login: user.login, avatar_url: user.avatar_url, name: user.name }
        });
        const deviceFingerprint = await generateDeviceFingerprint(request);
        return addCorsHeaders(await addSessionRenewalCookie(response, authResult, env, isSecure, deviceFingerprint), origin, env);
      }

      // === 仓库路由 ===
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

        const params = url.searchParams;
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

        const files = await listDir(authResult.githubToken, owner, repo, path, branch);
        return addCorsHeaders(Response.json({ success: true, data: files }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const params = url.searchParams;
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

        const file = await readFile(authResult.githubToken, owner, repo, filePath, branch);
        return addCorsHeaders(Response.json({ success: true, data: file }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'PUT') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const data = safeJsonParse(await request.text());
        const { owner, repo, path: filePath, content, base64Content, message, sha, branch = 'main', userName } = data as {
          owner?: string; repo?: string; path?: string; content?: string; base64Content?: string;
          message?: string; sha?: string; branch?: string; userName?: string;
        };

        const fileContent = base64Content || content;
        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !fileContent) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (typeof fileContent === 'string' && fileContent.length > MAX_CONTENT_SIZE) {
          return addCorsHeaders(Response.json({ error: 'File too large (max 10MB encoded)' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path or branch' }, { status: 400 }), origin, env);
        }

        let author: { name: string; email: string } | undefined;
        if (userName && /^[a-zA-Z0-9_-]+$/.test(userName)) {
          author = { name: `${userName} 来自 BloathCMS`, email: `${userName}@bloath.cms` };
        }

        await writeFile(authResult.githubToken, owner, repo, filePath, fileContent, message || 'update file', sha, branch, author, !!base64Content);
        return addCorsHeaders(Response.json({ success: true, data: { path: filePath } }), origin, env);
      }

      if (url.pathname === '/api/repos/file' && request.method === 'DELETE') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const data = safeJsonParse(await request.text());
        const { owner, repo, path: filePath, sha, message, branch = 'main', userName } = data as {
          owner?: string; repo?: string; path?: string; sha?: string;
          message?: string; branch?: string; userName?: string;
        };

        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !filePath || !sha) {
          return addCorsHeaders(Response.json({ error: 'Missing required fields' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(filePath, true) || !isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid path or branch' }, { status: 400 }), origin, env);
        }

        let author: { name: string; email: string } | undefined;
        if (userName && /^[a-zA-Z0-9_-]+$/.test(userName)) {
          author = { name: `${userName} 来自 BloathCMS`, email: `${userName}@bloath.cms` };
        }

        await deleteFile(authResult.githubToken, owner, repo, filePath, sha, message || 'delete file', branch, author);
        return addCorsHeaders(Response.json({ success: true }), origin, env);
      }

      // 获取仓库分支列表
      if (url.pathname.startsWith('/api/repos/') && url.pathname.endsWith('/branches')) {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        let owner = url.searchParams.get('owner');
        let repo = url.searchParams.get('repo');
        const parts = url.pathname.replace('/api/repos/', '').replace('/branches', '').split('/');
        owner = owner || parts[0] || null;
        repo = repo || parts[1] || null;

        if (!isSafePathParam(owner) || !isSafePathParam(repo)) {
          return addCorsHeaders(Response.json({ error: 'Missing owner or repo' }, { status: 400 }), origin, env);
        }

        const branches = await getRepoBranches(authResult.githubToken, owner, repo);
        return addCorsHeaders(Response.json({ success: true, data: branches }), origin, env);
      }

      // 获取仓库目录树
      if (url.pathname === '/api/repos/tree' && request.method === 'GET') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const params = url.searchParams;
        const owner = params.get('owner');
        const repo = params.get('repo');
        const branch = params.get('branch') || 'main';

        if (!isSafePathParam(owner) || !isSafePathParam(repo)) {
          return addCorsHeaders(Response.json({ error: 'Missing owner or repo' }, { status: 400 }), origin, env);
        }
        if (!isSafePathParam(branch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid branch' }, { status: 400 }), origin, env);
        }

        const tree = await getTree(authResult.githubToken, owner, repo, branch);
        return addCorsHeaders(Response.json({ success: true, data: tree }), origin, env);
      }

      // 创建分支
      if (url.pathname === '/api/repos/branch' && request.method === 'POST') {
        const authResult = await authenticate(request, env);
        if (authResult instanceof Response) return addCorsHeaders(authResult, origin, env);

        const data = safeJsonParse(await request.text());
        const { owner, repo, branchName, sourceBranch = 'main' } = data as {
          owner?: string; repo?: string; branchName?: string; sourceBranch?: string;
        };

        if (!isSafePathParam(owner) || !isSafePathParam(repo) || !isSafePathParam(branchName)) {
          return addCorsHeaders(Response.json({ error: 'Missing or invalid params' }, { status: 400 }), origin, env);
        }
        if (sourceBranch !== 'main' && !isSafePathParam(sourceBranch)) {
          return addCorsHeaders(Response.json({ error: 'Invalid source branch' }, { status: 400 }), origin, env);
        }

        await createBranch(authResult.githubToken, owner, repo, branchName, sourceBranch);
        return addCorsHeaders(Response.json({ success: true }), origin, env);
      }

      // 404
      return addCorsHeaders(Response.json({ error: 'Not found' }, { status: 404 }), origin, env);
    } catch (error) {
      if (error instanceof ApiError) {
        return addCorsHeaders(Response.json(
          { success: false, error: error.message },
          { status: error.statusCode }
        ), origin, env);
      }
      return addCorsHeaders(Response.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      ), origin, env);
    }
  }
};
