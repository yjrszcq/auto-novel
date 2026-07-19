import vue from '@vitejs/plugin-vue';
import Sonda from 'sonda/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import type { UserConfig } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());

  const userConfig: UserConfig = {
    build: {
      target: 'es2022',
      cssCodeSplit: false,
      rolldownOptions: {
        treeshake: true,
        output: {
          manualChunks(id) {
            if (id.includes('@zip.js')) {
              return 'dep-zip';
            }
          },
        },
      },
    },
    resolve: { tsconfigPaths: true },
    plugins: [
      vue(),
      createHtmlPlugin({
        minify: { minifyJS: true },
      }),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: '轻小说机翻机器人',
          short_name: '轻小说翻译',
          description: '管理、翻译和阅读本地轻小说',
          lang: 'zh-CN',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#101014',
          theme_color: '#18a058',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,mp3,webp,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/panel-content(?:\/|$)/],
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                (url.pathname.startsWith('/api/') ||
                  url.pathname.startsWith('/panel-content')),
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
      AutoImport({
        dts: 'src/auto-imports.d.ts',
        imports: [
          'vue',
          'vue-router',
          'pinia',
          {
            'naive-ui': [
              'useDialog',
              'useMessage',
              'useNotification',
              'useLoadingBar',
              'useThemeVars',
            ],
          },
        ],
      }),
      Components({
        dts: 'src/components.d.ts',
        dirs: ['src/**/components/**'],
        resolvers: [NaiveUiResolver()],
      }),
    ],
  };

  const enableSonda = env.VITE_ENABLE_SONDA === 'true';
  if (enableSonda) {
    userConfig.build!.sourcemap = true;
    userConfig.plugins!.push(
      Sonda({
        gzip: true,
        brotli: true,
      }),
    );
  }

  return userConfig;
});
