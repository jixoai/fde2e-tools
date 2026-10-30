import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/*
 * Vite 配置 —— file-viewer（迁自原 fde2e-fileviewer 仓，2026-10-30 并入本仓）
 *
 * 1. dev 仅绑 IPv4 回环（本仓约定，不占 frp 段）；
 * 2. dev/preview 回 ACAO:*——素材库以 sandbox iframe（无 allow-same-origin ⇒
 *    opaque origin）嵌入本站，module script 带 crossorigin 按 CORS 模式拉取，
 *    静态资源必须回 ACAO:*，否则嵌入形态整站白屏（原仓集成实证；生产头由
 *    OpenResty vhost 同步配置）；
 * 3. vitest：契约/嗅探/解码器注册表测试（迁入原仓 42 用例），node 环境；
 * 4. react 家族拆长效缓存 vendor chunk（解码器 chunk 由 React.lazy 动态
 *    import 天然按需拆分）。
 */
/// <reference types="vitest/config" />
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5275,
    strictPort: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  preview: { headers: { 'Access-Control-Allow-Origin': '*' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
});
