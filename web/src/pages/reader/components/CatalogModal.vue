<script lang="ts" setup>
import { SortOutlined } from '@vicons/material';

import type { GenericNovelId } from '@/model/Common';
import { useLocalVolumeStore, useSettingStore } from '@/stores';
import type { Result } from '@/util/result';
import { runCatching } from '@/util/result';

const props = defineProps<{
  show: boolean;
  gnid: GenericNovelId;
  chapterId: string;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
}>();

const router = useRouter();
const tocResult = shallowRef<Result<string[]>>();

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

const tocItems = computed(() => {
  if (tocResult.value?.ok) {
    const items = tocResult.value.value;
    return setting.value.tocSortReverse ? items.slice().reverse() : items;
  }
  return undefined;
});

watch(
  () => props.show,
  async (show) => {
    if (!show || tocResult.value?.ok) return;
    const repo = await useLocalVolumeStore();
    tocResult.value = await runCatching(async () => {
      const volume = await repo.getVolume(props.gnid.volumeId);
      if (!volume) {
        throw new Error('小说不存在');
      }
      return volume.toc.map((it) => it.chapterId ?? '');
    });
  },
);

const navigateToChapter = (chapterId: string) => {
  emit('update:show', false);
  router.push(
    `/workspace/reader/${encodeURIComponent(props.gnid.volumeId)}/${encodeURIComponent(chapterId)}`,
  );
};
</script>

<template>
  <c-modal
    :show="show"
    @update:show="$emit('update:show', $event)"
    style="min-height: 30vh; max-height: 80vh"
    content-style="overflow: auto;"
  >
    <template #header>
      <div style="display: flex; align-items: baseline">
        <span>目录</span>
        <n-text
          v-if="tocItems"
          depth="3"
          style="font-size: 12px; margin-left: 12px"
        >
          共{{ tocItems.length }}章
        </n-text>
        <div style="flex: 1" />
        <c-button
          :label="setting.tocSortReverse ? '倒序' : '正序'"
          :icon="SortOutlined"
          quaternary
          size="small"
          :round="false"
          @action="setting.tocSortReverse = !setting.tocSortReverse"
        />
      </div>
    </template>

    <c-result :result="tocResult">
      <n-list v-if="tocItems">
        <n-list-item
          v-for="chapter in tocItems"
          :key="chapter"
          class="chapter-item"
          :class="{ active: chapter === chapterId }"
          @click="navigateToChapter(chapter)"
        >
          <n-text>{{ chapter }}</n-text>
        </n-list-item>
      </n-list>
    </c-result>
  </c-modal>
</template>

<style scoped>
.chapter-item {
  cursor: pointer;
}
.chapter-item.active {
  background-color: rgba(0, 0, 0, 0.05);
}
</style>
