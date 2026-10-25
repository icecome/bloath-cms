// 生成 wrangler.deploy.jsonc：把模板中的 ${KV_NAMESPACE_ID} 替换为真实 ID。
// 原因：wrangler 4 对 kv_namespaces.id 不支持 ${ENV} 插值，故在部署前用脚本注入真实 ID。
// D1 database_id 已直接写入 wrangler.jsonc（非敏感信息），无需占位符。
// ID 来源优先级：环境变量 > .dev.vars
// 用法（在 cloudflare-worker 目录）：
//   KV_NAMESPACE_ID=xxx node scripts/fill-kv-namespace.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..');
const templatePath = path.join(cwd, 'wrangler.jsonc');
const outputPath = path.join(cwd, 'wrangler.deploy.jsonc');

async function readDotDevVars(key) {
  const file = path.join(cwd, '.dev.vars');
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf8');
  const line = raw.split(/\r?\n/).find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  const m = line?.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\s]+)`));
  return m ? m[1] : null;
}

async function resolveId(envKey) {
  return process.env[envKey] || (await readDotDevVars(envKey));
}

const kvNamespaceId = await resolveId('KV_NAMESPACE_ID');
// CACHE_KV 可选：树缓存用。未提供时部署脚本保留占位符会导致 wrangler 校验失败，
// 因此缺省时直接去掉 CACHE_KV 绑定（worker 侧按 CACHE_KV 未绑定优雅降级）。
const cacheKvNamespaceId = await resolveId('CACHE_KV_NAMESPACE_ID');

if (!kvNamespaceId) {
  console.error(
    '[fill-kv-namespace] 缺少 KV_NAMESPACE_ID，无法注入 KV 绑定。\n' +
    '  CI 部署：把其 ID 设为 GitHub Secret KV_NAMESPACE_ID；\n' +
    '  本地：在 cloudflare-worker/.dev.vars 写 KV_NAMESPACE_ID=xxx。'
  );
  process.exit(1);
}

let template = await readFile(templatePath, 'utf8');

if (!template.includes('${KV_NAMESPACE_ID}')) {
  console.error('[fill-kv-namespace] 模板 wrangler.jsonc 中未找到占位符 ${KV_NAMESPACE_ID}');
  process.exit(1);
}
template = template.replaceAll('${KV_NAMESPACE_ID}', kvNamespaceId);

if (cacheKvNamespaceId) {
  template = template.replaceAll('${CACHE_KV_NAMESPACE_ID}', cacheKvNamespaceId);
} else {
  console.warn('[fill-kv-namespace] 未提供 CACHE_KV_NAMESPACE_ID：移除树缓存 KV 绑定（getTree 将直连 GitHub，无缓存）');
  template = template.replaceAll(/,\s*\{\s*"binding":\s*"CACHE_KV",\s*"id":\s*"\$\{CACHE_KV_NAMESPACE_ID\}"\s*\}/g, '');
}

await writeFile(outputPath, template);
console.log(`[fill-kv-namespace] 已生成 ${outputPath}（KV Namespace ID 已注入）。`);
