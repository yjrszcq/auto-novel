<script lang="ts" setup>
import {
  FormatListBulletedOutlined,
  TuneOutlined,
  ArrowUpwardOutlined,
  ArrowDownwardOutlined,
} from '@vicons/material';

import type { ReaderChapter } from '../ReaderStore';

defineProps<{
  chapter: ReaderChapter;
}>();

const emit = defineEmits<{
  nav: [string];
  requireCatalogModal: [];
  requireSettingModal: [];
}>();

</script>

<template>
  <n-flex :wrap="false">
    <div style="flex: auto">
      <slot />
    </div>

    <div style="flex: 0 0 0">
      <n-flex size="large" vertical style="position: fixed; bottom: 20px">
        <side-button
          :disabled="!chapter.prevId"
          text="上一章"
          :icon="ArrowUpwardOutlined"
          @click="emit('nav', chapter.prevId!)"
        />
        <side-button
          :disabled="!chapter.nextId"
          text="下一章"
          :icon="ArrowDownwardOutlined"
          @click="emit('nav', chapter.nextId!)"
        />
        <side-button
          text="目录"
          :icon="FormatListBulletedOutlined"
          @click="emit('requireCatalogModal')"
        />
        <side-button
          text="设置"
          :icon="TuneOutlined"
          @click="emit('requireSettingModal')"
        />
      </n-flex>
    </div>
  </n-flex>
</template>
