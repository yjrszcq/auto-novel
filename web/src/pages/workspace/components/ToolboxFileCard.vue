<script lang="ts" setup>
import { DeleteOutlineOutlined, RemoveRedEyeOutlined } from '@vicons/material';

import { Humanize } from '@/util';
import type { ParsedFile } from '@/util/file';

import { getToolboxPreview } from './ToolboxPreview';

const props = withDefaults(
  defineProps<{
    file: ParsedFile;
    selected?: boolean;
    selectable?: boolean;
    removable?: boolean;
    kind?: 'source' | 'result';
  }>(),
  {
    selected: false,
    selectable: true,
    removable: true,
    kind: 'source',
  },
);

const emit = defineEmits<{
  delete: [];
  'update:selected': [value: boolean];
}>();

const showPreviewModal = ref(false);
const previewLoading = ref(false);
const previewText = ref('');
const previewTruncated = ref(false);
const previewError = ref('');
const fileSize = ref<number>();

watch(
  () => props.file,
  async (file) => {
    fileSize.value = undefined;
    try {
      fileSize.value = (await file.toBlob()).size;
    } catch {
      fileSize.value = undefined;
    }
  },
  { immediate: true },
);

const openPreview = async () => {
  showPreviewModal.value = true;
  previewLoading.value = true;
  previewError.value = '';
  try {
    const preview = await getToolboxPreview(props.file);
    previewText.value = preview.text;
    previewTruncated.value = preview.truncated;
  } catch (error) {
    previewError.value = String(error);
  } finally {
    previewLoading.value = false;
  }
};
</script>

<template>
  <n-flex align="center" class="toolbox-file-card" :size="6" :wrap="false">
    <n-checkbox
      v-if="selectable"
      :checked="selected"
      :aria-label="`选择 ${file.name}`"
      @update:checked="emit('update:selected', $event)"
    />
    <c-icon-button
      tooltip="预览"
      :aria-label="`预览 ${file.name}`"
      :icon="RemoveRedEyeOutlined"
      text
      size="small"
      type="primary"
      @action="openPreview"
    />
    <c-icon-button
      v-if="removable"
      tooltip="移除"
      :aria-label="`移除 ${file.name}`"
      :icon="DeleteOutlineOutlined"
      text
      size="small"
      type="error"
      @action="emit('delete')"
    />
    <n-text class="toolbox-file-card__name">{{ file.name }}</n-text>
    <n-tag :bordered="false" size="small">
      {{ file.type.toUpperCase() }}
    </n-tag>
    <n-tag
      :bordered="false"
      size="small"
      :type="kind === 'result' ? 'success' : 'default'"
    >
      {{ kind === 'result' ? '处理结果' : '源文件' }}
    </n-tag>
    <n-text depth="3" class="toolbox-file-card__size">
      {{ fileSize === undefined ? '计算中' : Humanize.bytes(fileSize) }}
    </n-text>
  </n-flex>

  <c-modal
    v-model:show="showPreviewModal"
    :title="`预览：${file.name}`"
    style="width: min(760px, 94vw)"
  >
    <n-spin :show="previewLoading">
      <n-alert v-if="previewError" type="error">{{ previewError }}</n-alert>
      <template v-else>
        <n-scrollbar style="max-height: min(65vh, 560px)">
          <pre class="toolbox-file-card__preview">{{ previewText }}</pre>
        </n-scrollbar>
        <n-text v-if="previewTruncated" depth="3">
          预览已截断，仅显示前 100 行或 20000 个字符。
        </n-text>
      </template>
    </n-spin>
  </c-modal>
</template>

<style scoped>
.toolbox-file-card {
  min-width: 0;
}

.toolbox-file-card__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbox-file-card__size {
  flex: none;
}

.toolbox-file-card__preview {
  margin: 0;
  padding: 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

@media (max-width: 639px) {
  .toolbox-file-card {
    flex-wrap: wrap !important;
  }

  .toolbox-file-card__name {
    width: calc(100% - 112px);
  }
}
</style>
