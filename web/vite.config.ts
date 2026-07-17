import vue from '@vitejs/plugin-vue';
import Sonda from 'sonda/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import type { UserConfig } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';

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
