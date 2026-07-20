<script lang="ts" setup>
import type { LocalVolumeTocEntry } from '@/model/LocalVolume';
import { InfoOutlined } from '@vicons/material';
import { useMediaQuery } from '@vueuse/core';

interface CatalogTitleDraft {
  chapterId: string;
  title: string;
  level: number;
}

const props = withDefaults(
  defineProps<{
    entries: readonly LocalVolumeTocEntry[];
    saving?: boolean;
    preparingRebuild?: boolean;
  }>(),
  { saving: false, preparingRebuild: false },
);
const emit = defineEmits<{
  confirm: [titles: { chapterId: string; title: string }[]];
  rebuild: [];
}>();
const show = defineModel<boolean>('show', { default: false });
const message = useMessage();
const isMobile = useMediaQuery('(max-width: 600px)');
const showRebuildConfirm = ref(false);
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

const rebuild = () => {
  showRebuildConfirm.value = false;
  emit('rebuild');
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
    aria-label="编辑目录显示文本"
    :bordered="false"
    :mask-closable="!props.saving"
    :closable="!props.saving"
    transform-origin="center"
    class="txt-catalog-title-modal"
  >
    <template #header>
      <div class="txt-catalog-title-header">
        <span>编辑目录显示文本</span>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger>
            <button
              type="button"
              class="txt-catalog-title-info"
              aria-label="目录标题编辑说明"
            >
              <n-icon :component="InfoOutlined" size="18" />
            </button>
          </template>
          <span>
            此处只修改目录显示文本，不改变正文、章节边界、层级、译文或阅读位置。
          </span>
        </n-popover>
      </div>
    </template>
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
      <div class="txt-catalog-title-actions">
        <n-popconfirm
          v-if="!isMobile"
          style="max-width: min(340px, calc(100vw - 16px))"
          positive-text="进入预览"
          negative-text="取消"
          @positive-click="emit('rebuild')"
        >
          <template #trigger>
            <n-button
              :disabled="props.saving"
              :loading="props.preparingRebuild"
            >
              重新解析目录
            </n-button>
          </template>
          完整重建允许修改目录位置和层级；不完整的译文来源会整套清除，确认预览前不会写入数据。
        </n-popconfirm>
        <n-button
          v-else
          :disabled="props.saving"
          :loading="props.preparingRebuild"
          @click="showRebuildConfirm = true"
        >
          重新解析目录
        </n-button>
        <n-flex justify="end" :wrap="false">
          <n-button :disabled="props.saving" @click="show = false">
            取消
          </n-button>
          <n-button type="primary" :loading="props.saving" @click="confirm">
            保存标题
          </n-button>
        </n-flex>
      </div>
    </template>
  </n-modal>
  <n-modal
    v-model:show="showRebuildConfirm"
    preset="dialog"
    aria-label="重新解析目录"
    title="重新解析目录"
    positive-text="进入预览"
    negative-text="取消"
    style="width: min(420px, calc(100vw - 24px))"
    @positive-click="rebuild"
  >
    完整重建允许修改目录位置和层级；不完整的译文来源会整套清除，确认预览前不会写入数据。
  </n-modal>
</template>

<style scoped>
.txt-catalog-title-list {
  height: min(62vh, 620px);
  border: 1px solid var(--n-border-color);
  border-radius: 4px;
}

.txt-catalog-title-header,
.txt-catalog-title-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.txt-catalog-title-header {
  justify-content: flex-start;
  gap: 4px;
}

.txt-catalog-title-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.txt-catalog-title-info:focus-visible {
  border-radius: 50%;
  outline: 2px solid var(--n-color-target);
  outline-offset: 2px;
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
