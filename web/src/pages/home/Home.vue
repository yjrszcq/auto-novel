<script lang="ts" setup>
import { WorkspacesOutlined } from '@vicons/material';

import bannerUrl from '@/image/banner.webp';
import BookshelfCollection from '@/pages/bookshelf/Bookshelf.vue';
import { useBreakPoints } from '@/pages/util';
import { useRuntimeConfigStore } from '@/stores';
import { useRuntimePanel } from '@/util/useRuntimePanel';

const bp = useBreakPoints();
const showShortcut = bp.smaller('tablet');
const vars = useThemeVars();

const runtimeConfigStore = useRuntimeConfigStore();
const { homeBackgroundImage, loaded, loading } =
  storeToRefs(runtimeConfigStore);
const bannerBackgroundUrl = computed(() =>
  loading.value && !loaded.value ? '' : homeBackgroundImage.value || bannerUrl,
);

const keyword = ref('');
const { html: infoPanelHtml } = useRuntimePanel('html/info.html');

const quickActions = [
  { label: '小说工具箱', to: '/workspace/toolbox', icon: WorkspacesOutlined },
  { label: 'GPT工作区', to: '/workspace/gpt', icon: WorkspacesOutlined },
  { label: 'Sakura工作区', to: '/workspace/sakura', icon: WorkspacesOutlined },
  { label: '交互翻译', to: '/workspace/interactive', icon: WorkspacesOutlined },
];

const handleSearch = () => {
  keyword.value = keyword.value.trim();
};
</script>

<template>
  <div
    :style="{
      background: bannerBackgroundUrl
        ? `rgba(0, 0, 0, .25) url(${bannerBackgroundUrl})`
        : 'rgba(0, 0, 0, .25)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }"
    style="background-blend-mode: darken"
  >
    <div id="banner" class="layout-content">
      <n-h1
        style="
          text-align: center;
          font-size: 3em;
          color: white;
          filter: drop-shadow(0.05em 0.05em black);
        "
      >
        轻小说机翻机器人
      </n-h1>
      <n-input-group>
        <n-input
          v-model:value="keyword"
          size="large"
          placeholder="输入书名，搜索书架"
          :input-props="{ spellcheck: false }"
          :style="{ 'background-color': vars.bodyColor }"
          @keyup.enter="handleSearch"
        />
        <n-button size="large" type="primary" @click="handleSearch">
          搜索
        </n-button>
      </n-input-group>
    </div>
  </div>

  <div class="layout-content">
    <n-flex
      v-if="showShortcut"
      :size="0"
      justify="space-around"
      :wrap="false"
      style="margin: 8px 0"
    >
      <router-link
        v-for="action in quickActions"
        :key="action.to"
        :to="action.to"
        style="flex: 1"
      >
        <n-button quaternary style="width: 100%; height: 64px">
          <n-flex align="center" vertical style="font-size: 12px">
            <n-icon size="24" :component="action.icon" />
            {{ action.label }}
          </n-flex>
        </n-button>
      </router-link>
    </n-flex>
    <div v-else style="height: 16px" />

    <bulletin v-if="infoPanelHtml">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-html="infoPanelHtml" />
    </bulletin>

    <BookshelfCollection v-model:query="keyword" embedded hide-search />
  </div>
</template>

<style scoped>
#banner {
  max-width: 800px;
  padding-top: 20px;
  padding-bottom: 50px;
}

@media only screen and (max-width: 600px) {
  #banner {
    padding-top: 10px;
    padding-bottom: 35px;
  }
}
</style>
