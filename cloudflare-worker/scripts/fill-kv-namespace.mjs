// 生成 wrangler.deploy.jsonc：把模板中的 ${KV_NAMESPACE_ID} 替换为真实命名空间 ID。
// 原因：wrangler 4 对 kv_namespaces.id 不支持 ${ENV} 插值，故在部署前用脚本注入真实 ID。
// ID 来源优先级：环境变量 KV_NAMESPACE_ID > .dev.vars 中的 KV_NAMESPACE_ID
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
const PLACEHOLDER = '${KV_NAMESPACE_ID}';

async function readDotDevVars() {
  const file = path.join(cwd, '.dev.vars');
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf8');
  const line = raw.split(/\r?\n/).find((l) => /^\s*KV_NAMESPACE_ID\s*=/.test(l));
  const m = line?.match(/^\s*KV_NAMESPACE_ID\s*=\s*["']?([^"'\s]+)/);
  return m ? m[1] : null;
}

const namespaceId = process.env.KV_NAMESPACE_ID || (await readDotDevVars());

if (!namespaceId) {
  console.error(
    '[fill-kv-namespace] 缺少 KV_NAMESPACE_ID，无法注入 KV 绑定。\n' +
    '  部署者只需：\n' +
    '  1) 创建自己的 Cloudflare KV Namespace；\n' +
    '  2) CI 部署：把其 ID 设为 GitHub Secret KV_NAMESPACE_ID；\n' +
    '     本地：在 cloudflare-worker/.dev.vars 写 KV_NAMESPACE_ID=xxx。\n' +
    '  全程无需修改任何源码。'
  );
  process.exit(1);
}

const template = await readFile(templatePath, 'utf8');
if (!template.includes(PLACEHOLDER)) {
  console.error('[fill-kv-namespace] 模板 wrangler.jsonc 中未找到占位符 ' + PLACEHOLDER);
  process.exit(1);
}

await writeFile(outputPath, template.replaceAll(PLACEHOLDER, namespaceId));
console.log(`[fill-kv-namespace] 已生成 ${outputPath}（KV Namespace ID 已注入）。`);