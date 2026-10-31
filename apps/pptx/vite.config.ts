import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import IconsResolver from 'unplugin-icons/resolver';
import Components from 'unplugin-vue-components/vite';

/*
 * Vite 配置 —— dev 仅绑 IPv4 回环（不对外暴露，不占 frp 段）；构建产物纯静态。
 *
 * 本 app＝React solid-glass 外框 ＋ PPTist Vue 编辑器岛（整库嵌入，AGPL 隔离目录
 * src/pptist/）。插件链与 PPTist 上游 vite.config 同形（vue + unplugin-icons +
 * unplugin-vue-components 仅解析 i-* 图标；scss additionalData 注入 variable/mixin），
 * alias @ 指向 vendored 树 src/pptist/（上游源码零改动，其 @/ 导入照常工作）。
 * PPTist 大库经 bridge.ts dynamic import 懒加载独立 chunk（体积纪律）。
 */
export default defineConfig({
  plugins: [
    react(),
    vue(),
    Components({
      dirs: [],
      resolvers: [
        IconsResolver({
          prefix: 'i',
          customCollections: ['custom'],
        }),
      ],
    }),
    Icons({
      compiler: 'vue3',
      autoInstall: false,
      customCollections: {
        custom: FileSystemIconLoader('src/pptist/assets/icons'),
      },
      scale: 1,
      defaultClass: 'i-icon',
    }),
    tailwindcss(),
  ],
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `
          @import '@/assets/styles/variable.scss';
          @import '@/assets/styles/mixin.scss';
        `,
      },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/pptist', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5280, strictPort: true },
});
