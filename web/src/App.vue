<script lang="ts" setup>
import { darkTheme, dateZhCN, useOsTheme, zhCN } from 'naive-ui';

import { useRuntimeConfigStore, useSettingStore } from '@/stores';
import { RegexUtil } from '@/util';

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

const runtimeConfigStore = useRuntimeConfigStore();
void runtimeConfigStore.loadRuntimeConfig();

// 主题
const osThemeRef = useOsTheme();

const isDarkTheme = computed(() => {
  const theme = setting.value.theme;
  switch (theme) {
    case 'light':
      return false;
    case 'dark':
      return true;
    case 'system':
      return osThemeRef.value === 'dark';
  }
});

// 处理Safari的奇妙问题
if (RegexUtil.isSafari(navigator.userAgent)) {
  // 防止Safari返回上一页时的灰屏
  // https://github.com/reactjs/react.dev/blob/e45ac5552c13fc50832624b7deb0c6f631d461bf/src/pages/_app.tsx#L30
  window.history.scrollRestoration = 'auto';

  // 禁用浏览器聚焦时的自动缩放，但浏览器还是会允许用户手动缩放
  const meta = document.querySelector('meta[name="viewport"]')!;
  const content = meta.getAttribute('content')!;
  meta.setAttribute('content', `${content}, user-scalable=no`);
}
</script>

<template>
  <n-config-provider
    :theme="isDarkTheme ? darkTheme : null"
    :locale="zhCN"
    :date-locale="dateZhCN"
    inline-theme-disabled
    :theme-overrides="{
      Drawer: { bodyPadding: '0px' },
      List: { color: '#0000' },
    }"
  >
    <n-global-style />
    <n-message-provider container-style="white-space: pre-wrap">
      <n-loading-bar-provider>
        <router-view v-slot="{ Component }">
          <keep-alive :include="['MainLayout']">
            <component :is="Component" />
          </keep-alive>
        </router-view>
        <PwaUpdatePrompt />
      </n-loading-bar-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
a {
  text-decoration: none;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
p,
li {
  overflow-wrap: break-word;
  word-break: break-word;
}
.n-h:first-child {
  margin: var(--n-margin);
}
.text-2line {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.float {
  position: fixed;
  right: 40px;
  bottom: 20px;
  box-shadow: rgb(0 0 0 / 40%) 2px 2px 8px 0px;
}
.n-drawer-header__main {
  flex: 1;
}
.sortable-ghost {
  opacity: 0.7;
}

@supports (-webkit-touch-callout: none) {
  /* 仅在支持 -webkit-touch-callout 的设备上生效（iOS 特有） */

  .v-vl:not(.v-vl--show-scrollbar),
  .n-scrollbar > .n-scrollbar-container {
    scrollbar-width: unset;
  }

  .v-vl:not(.v-vl--show-scrollbar)::-webkit-scrollbar,
  .v-vl:not(.v-vl--show-scrollbar)::-webkit-scrollbar-track-piece,
  .v-vl:not(.v-vl--show-scrollbar)::-webkit-scrollbar-thumb,
  .n-scrollbar > .n-scrollbar-container::-webkit-scrollbar,
  .n-scrollbar > .n-scrollbar-container::-webkit-scrollbar-track-piece,
  .n-scrollbar > .n-scrollbar-container::-webkit-scrollbar-thumb {
    width: unset;
    height: unset;
    display: unset;
  }
}
</style>
