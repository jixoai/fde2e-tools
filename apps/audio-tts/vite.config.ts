import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, rmSync, statSync, createReadStream } from 'node:fs';
import { join, normalize } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * sherpa wasm vendor 是仓内静态资产（非 npm 依赖、非 import 图节点）——
 * dev：configureServer 中间件以 /vendor/* 直出 src/vendor/*（与构建产物同 URL）；
 * build：closeBundle 拷贝 src/vendor → dist/vendor（vite 不处理静态资产软链）。
 */
function sherpaVendorPlugin(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const vendorDir = join(root, 'src', 'vendor');
  return {
    name: 'sherpa-vendor',
    configureServer(server) {
      server.middlewares.use('/vendor', (req, res, next) => {
        const rel = decodeURIComponent(String(req.url ?? '').split('?')[0]);
        const file = normalize(join(vendorDir, rel));
        if (!file.startsWith(vendorDir) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('nf');
          return;
        }
        res.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const dest = join(root, 'dist', 'vendor');
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      cpSync(vendorDir, dest, { recursive: true });
    },
  };
}

/*
 * Vite 配置 —— audio-tts（audio-stt-tts）
 * dev 仅绑 IPv4 回环（本仓约定，不占 frp 段）；构建产物纯静态。
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), sherpaVendorPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5282, strictPort: true },
});
