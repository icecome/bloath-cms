#!/usr/bin/env node
// 快速测量：中国本地到 GitHub API vs Cloudflare 转发的延迟差异
// 用法：node scripts/measure-latency.mjs
import { request } from 'https';

const TARGETS = [
  { name: 'GitHub API 直连', url: 'https://api.github.com/user' },
  { name: 'GitHub.com 主站', url: 'https://github.com' },
];

console.log('开始测量...\n');

for (const { name, url } of TARGETS) {
  const start = Date.now();
  await new Promise((resolve, reject) => {
    const req = request(url, { method: 'HEAD', headers: { 'User-Agent': 'Bloath-CMS' } }, (res) => {
      console.log(`  ${name}: ${res.statusCode} | ${Date.now() - start}ms`);
      res.resume(); // 必须 consume response
      resolve();
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

console.log('\n说明：这是到 GitHub 的纯网络 RTT，不含你的业务逻辑耗时。');
console.log('如果这个值 > 500ms，瓶颈就是跨境链路，值得考虑 Worker 区域调整。');
