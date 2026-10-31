import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/*
 * Vite 配置 —— dev 仅绑 IPv4 回环（不对外暴露，不占 frp 段）；构建产物纯静态。
 * TipTap/docx/mammoth 桥经 dynamic import 独立 chunk（docx-editor.ts /
 * docx-bridge.ts），主包只装 solid-glass 外框（体积纪律）。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5279, strictPort: true },
});
