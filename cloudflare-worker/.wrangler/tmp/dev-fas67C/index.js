var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/github.ts
async function exchangeCode(code, clientSecret, clientId, redirectUri) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to exchange code for token");
  }
  return data.access_token;
}
__name(exchangeCode, "exchangeCode");
async function getUserInfo(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Bloath-CMS"
    }
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch user info: ${response.status} - ${error}`);
  }
  return response.json();
}
__name(getUserInfo, "getUserInfo");
async function getUserRepos(token) {
  const response = await fetch("https://api.github.com/user/repos?per_page=100", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Bloath-CMS"
    }
  });
  if (!response.ok) {
    throw new Error("Failed to fetch repositories");
  }
  return response.json();
}
__name(getUserRepos, "getUserRepos");
async function readFile(token, owner, repo, path, branch = "main") {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Bloath-CMS"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to read file: ${response.statusText}`);
  }
  const data = await response.json();
  const binaryString = atob(data.content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const text = new TextDecoder().decode(bytes);
  return {
    content: text,
    sha: data.sha
  };
}
__name(readFile, "readFile");
async function writeFile(token, owner, repo, path, content, message, sha, branch = "main", author) {
  const base64Content = btoa(unescape(encodeURIComponent(content)));
  const payload = {
    message,
    content: base64Content,
    branch
  };
  if (sha) {
    payload.sha = sha;
  }
  if (author) {
    payload.author = author;
  }
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Bloath-CMS",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to write file");
  }
}
__name(writeFile, "writeFile");
async function deleteFile(token, owner, repo, path, sha, message, branch = "main") {
  const payload = {
    message,
    sha
  };
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Bloath-CMS",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to delete file");
  }
}
__name(deleteFile, "deleteFile");
async function listDir(token, owner, repo, path, branch = "main") {
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  const apiUrl = normalizedPath ? `https://api.github.com/repos/${owner}/${repo}/contents/${normalizedPath}?ref=${encodeURIComponent(branch)}` : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Bloath-CMS"
    }
  });
  console.log("[listDir] Request URL:", apiUrl);
  if (!response.ok) {
    const errorBody = await response.text();
    console.log("[listDir] Error body:", errorBody);
    throw new Error(`${response.status}: ${response.statusText} - ${errorBody}`);
  }
  const data = await response.json();
  console.log("[listDir] Response data count:", data.length, "Items:", data.map((i) => i.name).join(", "));
  return data.map((item) => ({
    name: item.name,
    path: item.path,
    sha: item.sha,
    type: item.type,
    size: item.size
  }));
}
__name(listDir, "listDir");
async function getRepoBranches(token, owner, repo) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Bloath-CMS"
      }
    }
  );
  if (!response.ok) {
    return ["main"];
  }
  const data = await response.json();
  return data.map((branch) => branch.name);
}
__name(getRepoBranches, "getRepoBranches");

// src/index.ts
var SESSION_TTL = 86400;
var sessions = /* @__PURE__ */ new Map();
var states = /* @__PURE__ */ new Map();
function storeState(state, frontendUrl) {
  states.set(state, { frontendUrl, createdAt: Date.now() });
}
__name(storeState, "storeState");
function consumeState(state) {
  const data = states.get(state);
  if (!data) return null;
  states.delete(state);
  return data;
}
__name(consumeState, "consumeState");
var SessionManager = class {
  static {
    __name(this, "SessionManager");
  }
  async setSession(token, sessionKey) {
    sessions.set(sessionKey, {
      token,
      createdAt: Date.now()
    });
  }
  async getSession(sessionKey) {
    return sessions.get(sessionKey) || null;
  }
  async deleteSession(sessionKey) {
    sessions.delete(sessionKey);
  }
  // 清理过期 session（在每次请求时调用）
  cleanup() {
    const now = Date.now();
    for (const [key, value] of sessions) {
      if (now - value.createdAt > SESSION_TTL * 1e3) {
        sessions.delete(key);
      }
    }
  }
};
var sessionManager = new SessionManager();
function corsHeaders(origin, env) {
  const allowedOrigins = [
    env.FRONTEND_URL || "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173"
  ];
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Frontend-Url",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
function addCorsHeaders(response, origin, env) {
  Object.entries(corsHeaders(origin, env)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}
__name(addCorsHeaders, "addCorsHeaders");
function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(generateState, "generateState");
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";
    const workerUrl = env.CF_WORKER_URL || "http://localhost:8787";
    const frontendUrl = request.headers.get("X-Frontend-Url") || env.FRONTEND_URL || "http://localhost:3000";
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(origin, env)
      });
    }
    try {
      sessionManager.cleanup();
      if (url.pathname === "/api/auth/login" && request.method === "GET") {
        const state = generateState();
        storeState(state, frontendUrl);
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(workerUrl + "/api/auth/callback")}&scope=repo%20user:email&state=${state}&prompt=authorize`;
        return addCorsHeaders(Response.json({ authUrl }), origin, env);
      }
      if (url.pathname === "/api/auth/callback" && request.method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          return addCorsHeaders(Response.json({ error: "Missing code or state" }, { status: 400 }), origin, env);
        }
        const stateData = consumeState(state);
        if (!stateData) {
          return addCorsHeaders(Response.json({ error: "Invalid state" }, { status: 400 }), origin, env);
        }
        const storedFrontendUrl = stateData.frontendUrl || frontendUrl;
        const accessToken = await exchangeCode(code, env.GITHUB_CLIENT_SECRET, env.GITHUB_CLIENT_ID, workerUrl + "/api/auth/callback");
        const user = await getUserInfo(accessToken);
        const sessionKey = Math.random().toString(36).substring(2);
        await sessionManager.setSession(accessToken, sessionKey);
        const redirectUrl = `${storedFrontendUrl}/login#${encodeURIComponent(JSON.stringify({
          token: sessionKey,
          login: user.login,
          avatar: user.avatar_url,
          name: user.name || ""
        }))}`;
        return addCorsHeaders(new Response(null, {
          status: 302,
          headers: { "Location": redirectUrl }
        }), origin, env);
      }
      if (url.pathname === "/api/me" && request.method === "GET") {
        const sessionKey = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
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
      if (url.pathname === "/api/repos" && request.method === "GET") {
        const sessionKey = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const repos = await getUserRepos(session.token);
        return addCorsHeaders(Response.json({
          success: true,
          data: repos.filter((repo) => repo.name !== ".github")
        }), origin, env);
      }
      if (url.pathname === "/api/repos/files" && request.method === "GET") {
        const sessionKey = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const token = session.token;
        const params = new URL(request.url).searchParams;
        const owner = params.get("owner");
        const repo = params.get("repo");
        const path = params.get("path") || "";
        const branch = params.get("branch") || "main";
        if (!owner || !repo) {
          return addCorsHeaders(Response.json({ error: "Missing owner or repo" }, { status: 400 }), origin, env);
        }
        const files = await listDir(token, owner, repo, path, branch);
        return addCorsHeaders(Response.json({ success: true, data: files }), origin, env);
      }
      if (url.pathname === "/api/repos/file" && request.method === "GET") {
        const sessionKey = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const token = session.token;
        const params = new URL(request.url).searchParams;
        const owner = params.get("owner");
        const repo = params.get("repo");
        const path = params.get("path");
        const branch = params.get("branch") || "main";
        if (!owner || !repo || !path) {
          return addCorsHeaders(Response.json({ error: "Missing required params" }, { status: 400 }), origin, env);
        }
        const file = await readFile(token, owner, repo, path, branch);
        return addCorsHeaders(Response.json({ success: true, data: file }), origin, env);
      }
      if (url.pathname === "/api/repos/file" && request.method === "PUT") {
        const sessionKey = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const token = session.token;
        const data = await request.json();
        const { owner, repo, path: filePath, content, message, sha, branch = "main", author } = data;
        if (!owner || !repo || !filePath || !content) {
          return addCorsHeaders(Response.json({ error: "Missing required fields" }, { status: 400 }), origin, env);
        }
        await writeFile(token, owner, repo, filePath, content, message, sha, branch, author);
        return addCorsHeaders(Response.json({ success: true, data: { path: filePath } }), origin, env);
      }
      if (url.pathname === "/api/repos/file" && request.method === "DELETE") {
        const sessionKey = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const token = session.token;
        const data = await request.json();
        const { owner, repo, path: filePath, sha, message, branch = "main" } = data;
        if (!owner || !repo || !filePath || !sha) {
          return addCorsHeaders(Response.json({ error: "Missing required fields" }, { status: 400 }), origin, env);
        }
        await deleteFile(token, owner, repo, filePath, sha, message, branch);
        return addCorsHeaders(Response.json({ success: true }), origin, env);
      }
      if (url.pathname === "/api/repos/branches" || url.pathname.startsWith("/api/repos/") && url.pathname.endsWith("/branches")) {
        const sessionKey = request.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionKey) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const session = await sessionManager.getSession(sessionKey);
        if (!session) {
          return addCorsHeaders(Response.json({ error: "Unauthorized" }, { status: 401 }), origin, env);
        }
        const token = session.token;
        let owner = url.searchParams.get("owner");
        let repo = url.searchParams.get("repo");
        if (url.pathname.startsWith("/api/repos/") && url.pathname.endsWith("/branches")) {
          const parts = url.pathname.replace("/api/repos/", "").replace("/branches", "").split("/");
          owner = owner || parts[0] || null;
          repo = repo || parts[1] || null;
        }
        if (!owner || !repo) {
          return addCorsHeaders(Response.json({ error: "Missing owner or repo" }, { status: 400 }), origin, env);
        }
        const branches = await getRepoBranches(token, owner, repo);
        return addCorsHeaders(Response.json({ success: true, data: branches }), origin, env);
      }
      return addCorsHeaders(Response.json({ error: "Not found" }, { status: 404 }), origin, env);
    } catch (error) {
      console.error("Worker error:", error);
      return addCorsHeaders(Response.json(
        { success: false, error: error instanceof Error ? error.message : "Internal server error" },
        { status: 500 }
      ), origin, env);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-3bBecs/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-3bBecs/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
