<script lang="ts" setup>
import {
  DarkModeOutlined,
  HomeOutlined,
  MenuOutlined,
  SettingsOutlined,
  WbSunnyOutlined,
  WorkspacesOutlined,
} from '@vicons/material';
import type { MenuOption } from 'naive-ui';
import { NIcon, useOsTheme } from 'naive-ui';
import { RouterLink } from 'vue-router';

import { useBreakPoints } from '@/pages/util';
import { useSettingStore } from '@/stores';

const bp = useBreakPoints();
const hasSider = bp.greater('tablet');
const menuShowTrigger = bp.greater('desktop');
const showMenuModal = ref(false);

watch(hasSider, () => (showMenuModal.value = false));

const route = useRoute();

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

const osTheme = useOsTheme();
const activeTheme = computed<'light' | 'dark'>(() => {
  if (setting.value.theme === 'system') {
    return osTheme.value ?? 'light';
  }
  return setting.value.theme;
});

const toggleTheme = () => {
  setting.value.theme = activeTheme.value === 'light' ? 'dark' : 'light';
};

const menuCollapsed = computed(() => {
  if (menuShowTrigger.value) {
    return setting.value.menuCollapsed;
  } else {
    return true;
  }
});

const renderLabel = (text: string, href: string) => () =>
  h(RouterLink, { to: href }, { default: () => text });
const renderIcon = (icon: Component) => () =>
  h(NIcon, null, { default: () => h(icon) });

const menuOptions = computed<MenuOption[]>(() => [
  {
    label: renderLabel('首页', '/'),
    icon: renderIcon(HomeOutlined),
    key: '/',
  },
  {
    label: '工作区',
    icon: renderIcon(WorkspacesOutlined),
    key: '/workspace',
    children: [
      {
        label: renderLabel('小说工具箱', '/workspace/toolbox'),
        key: '/workspace/toolbox',
      },
      {
        label: renderLabel('GPT工作区', '/workspace/gpt'),
        key: '/workspace/gpt',
      },
      {
        label: renderLabel('Sakura工作区', '/workspace/sakura'),
        key: '/workspace/sakura',
      },
      {
        label: renderLabel('交互翻译', '/workspace/interactive'),
        key: '/workspace/interactive',
      },
    ],
  },
  {
    label: renderLabel('设置', '/setting'),
    icon: renderIcon(SettingsOutlined),
    key: '/setting',
  },
  {
    label: () =>
      h(
        'a',
        {
          onClick: toggleTheme,
        },
        { default: () => '切换主题' },
      ),
    icon: renderIcon(
      activeTheme.value === 'light' ? WbSunnyOutlined : DarkModeOutlined,
    ),
    key: 'theme',
  },
]);

const menuKey = computed(() => {
  const path = route.path;
  const workspaceMenus = [
    '/workspace/toolbox',
    '/workspace/gpt',
    '/workspace/sakura',
    '/workspace/interactive',
  ];
  const matchedWorkspace = workspaceMenus.find((item) =>
    path.startsWith(item),
  );
  if (matchedWorkspace) {
    return matchedWorkspace;
  }
  return path === '/' ? '/' : path;
});

watch(
  () => route.path,
  () => (showMenuModal.value = false),
);
</script>

<template>
  <n-layout :has-sider="hasSider" style="width: 100%; min-height: 100vh">
    <n-layout-header bordered style="position: fixed; z-index: 2">
      <n-flex align="center" style="height: 50px" :size="0">
        <n-button
          v-if="!hasSider"
          size="large"
          quaternary
          circle
          :focusable="false"
          style="margin: 0 8px"
          @click="showMenuModal = true"
        >
          <n-icon size="24" :component="MenuOutlined" />
        </n-button>
        <div v-else style="padding: 0 16px">
          <robot-icon size="32" />
        </div>

        <div style="flex: 1" />

        <n-button
          size="large"
          quaternary
          circle
          :focusable="false"
          style="margin-right: 8px"
          @click="toggleTheme"
        >
          <n-icon
            size="20"
            :component="activeTheme === 'light' ? WbSunnyOutlined : DarkModeOutlined"
          />
        </n-button>
      </n-flex>
    </n-layout-header>

    <n-layout-sider
      v-if="hasSider"
      :show-trigger="menuShowTrigger"
      :trigger-style="{ position: 'fixed', top: '80%', left: '214px' }"
      :collapsed-trigger-style="{ position: 'fixed', top: '80%', left: '36px' }"
      bordered
      :width="240"
      :collapsed="menuCollapsed"
      :collapsed-width="64"
      collapse-mode="width"
      :native-scrollbar="false"
      style="z-index: 1"
      @collapse="setting.menuCollapsed = true"
      @expand="setting.menuCollapsed = false"
    >
      <n-scrollbar
        style="margin-top: 50px; position: fixed; top: 0"
        :style="{ width: menuCollapsed ? '64px' : '240px' }"
      >
        <n-menu
          :value="menuKey"
          :options="menuOptions"
          :width="240"
          :collapsed="menuCollapsed"
          :collapsed-width="64"
          :collapsed-icon-size="22"
          style="margin-bottom: 64px"
        />
      </n-scrollbar>
    </n-layout-sider>

    <n-layout-content
      style="
        margin-top: 50px;
        margin-bottom: 64px;
        z-index: 0;
        min-height: calc(100vh - 50px);
      "
    >
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </n-layout-content>
  </n-layout>

  <c-drawer-left v-if="!hasSider" v-model:show="showMenuModal">
    <n-menu :value="menuKey" :options="menuOptions" />
  </c-drawer-left>
</template>

<style>
.layout-content {
  max-width: 1000px;
  margin: 0 auto;
  padding-left: 30px;
  padding-right: 30px;
}
@media only screen and (max-width: 600px) {
  .layout-content {
    padding-left: 12px;
    padding-right: 12px;
  }
}
</style>
