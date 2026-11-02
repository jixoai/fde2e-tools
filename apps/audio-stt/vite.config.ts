import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, rmSync, statSync, createReadStream } from 'node:fs';
import { join, normalize } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * sherpa wasm vendor：dev 中间件 /vendor/* 直出 src/vendor/*；build closeBundle
 * 拷贝 dist/vendor（与 apps/audio-tts 同插件，复制自同一份实现——见其头注）。
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
 * Vite 配置 —— audio-stt（audio-stt-tts）；dev 5281（registry 约定顺延段）。
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), sherpaVendorPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5281, strictPort: true },
});
