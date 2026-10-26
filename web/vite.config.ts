import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 让 Cloudflare Rocket Loader 跳过入口 module 脚本。
 *
 * 生产站点（bloath.icecome.com）在 Cloudflare 上开着 Rocket Loader，它会把
 * `<script type="module">` 改写成 `<script type="<hash>-module">` 再异步重新注入，
 * 模块脚本的执行上下文因此改变，表现为间歇性的
 * `Failed to fetch dynamically imported module`。
 *
 * 豁免方式是给脚本标签加 `data-cfasync="false"`，且该属性必须出现在 `src` 之前。
 * index.html 里已经写了这条属性，但 Vite 构建阶段会重建入口 script 标签、把不认识的
 * 属性丢掉（实测 dist/index.html 里没有），所以在产物上再补一次。
 */
function rocketLoaderOptOut(): Plugin {
  const ENTRY_MODULE_TAG = /<script\b(?![^>]*\bdata-cfasync=)[^>]*\btype="module"/g;
  return {
    name: 'bloath:rocket-loader-opt-out',
    enforce: 'post',
    transformIndexHtml(html: string) {
      return html.replace(ENTRY_MODULE_TAG, (tag) => tag.replace(/\btype="module"/, 'data-cfasync="false" type="module"'));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), rocketLoaderOptOut()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/vditor')) return 'vditor';
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  }
});
