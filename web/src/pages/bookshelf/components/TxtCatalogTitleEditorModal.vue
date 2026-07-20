<script lang="ts" setup>
import type { LocalVolumeTocEntry } from '@/model/LocalVolume';

interface CatalogTitleDraft {
  chapterId: string;
  title: string;
  level: number;
}

const props = withDefaults(
  defineProps<{
    entries: readonly LocalVolumeTocEntry[];
    saving?: boolean;
  }>(),
  { saving: false },
);
const emit = defineEmits<{
  confirm: [titles: { chapterId: string; title: string }[]];
}>();
const show = defineModel<boolean>('show', { default: false });
const message = useMessage();
const drafts = ref<CatalogTitleDraft[]>([]);

const resetDrafts = () => {
  drafts.value = props.entries.map((entry) => ({
    chapterId: entry.chapterId,
    title: entry.title ?? '',
    level: entry.level ?? 1,
  }));
};

const updateTitle = (index: number, title: string) => {
  const draft = drafts.value[index];
  if (draft !== undefined) drafts.value[index] = { ...draft, title };
};

const confirm = () => {
  const invalidIndex = drafts.value.findIndex(
    ({ title }) => title.trim().length === 0,
  );
  if (invalidIndex >= 0) {
    message.error(`第 ${invalidIndex + 1} 项目录标题不能为空`);
    return;
  }
  emit(
    'confirm',
    drafts.value.map(({ chapterId, title }) => ({
      chapterId,
      title: title.trim(),
    })),
  );
};

watch(
  () => [show.value, props.entries] as const,
  ([visible]) => {
    if (visible) resetDrafts();
  },
  { immediate: true },
);
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="编辑目录显示文本"
    aria-label="编辑目录显示文本"
    :bordered="false"
    :mask-closable="!props.saving"
    :closable="!props.saving"
    class="txt-catalog-title-modal"
  >
    <n-alert type="info" :show-icon="false">
      此处只修改目录显示文本，不改变正文、章节边界、层级、译文或阅读位置。
    </n-alert>
    <n-virtual-list
      class="txt-catalog-title-list"
      :items="drafts"
      :item-size="58"
      item-resizable
      key-field="chapterId"
    >
      <template #default="{ item, index }">
        <div class="txt-catalog-title-row">
          <span class="txt-catalog-title-index">{{ index + 1 }}</span>
          <n-tag size="small" :bordered="false">{{ item.level }} 级</n-tag>
          <n-input
            :value="item.title"
            maxlength="300"
            show-count
            @update:value="(title) => updateTitle(index, title)"
          />
        </div>
      </template>
    </n-virtual-list>
    <template #action>
      <n-flex justify="end" :wrap="false">
        <n-button :disabled="props.saving" @click="show = false">取消</n-button>
        <n-button type="primary" :loading="props.saving" @click="confirm">
          保存标题
        </n-button>
      </n-flex>
    </template>
  </n-modal>
</template>

<style scoped>
.txt-catalog-title-list {
  height: min(62vh, 620px);
  margin-top: 12px;
  border: 1px solid var(--n-border-color);
  border-radius: 4px;
}

.txt-catalog-title-row {
  display: grid;
  grid-template-columns: 52px 56px minmax(0, 1fr);
  align-items: center;
  min-height: 58px;
  box-sizing: border-box;
  padding: 7px 10px;
  border-bottom: 1px solid var(--n-border-color);
  gap: 8px;
}

.txt-catalog-title-index {
  color: var(--n-text-color-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

@media (max-width: 600px) {
  .txt-catalog-title-row {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .txt-catalog-title-row :deep(.n-tag) {
    display: none;
  }
}
</style>

<style>
.txt-catalog-title-modal {
  width: min(760px, calc(100vw - 24px));
}
</style>
