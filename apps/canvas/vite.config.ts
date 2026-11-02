import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/*
 * Canvas —— Vite 配置。
 * dev 仅绑 IPv4 回环（不对外暴露，不占 frp 段）；构建产物纯静态。
 * Satori/resvg-wasm 走浏览器 wasm：保留 wasm 资产并排除预打包，
 * 避免 Vite optimizeDeps 把 wasm 入口改写坏。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['satori', '@resvg/resvg-wasm'],
  },
  server: { host: '127.0.0.1', port: 5273, strictPort: true },
});
