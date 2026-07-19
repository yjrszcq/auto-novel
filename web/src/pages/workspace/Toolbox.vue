<script lang="ts" setup>
import { DeleteOutlineOutlined, PlusOutlined } from '@vicons/material';
import type { UploadCustomRequestOptions } from 'naive-ui';

import { useLocalVolumeStore } from '@/stores';
import type { ParsedFile } from '@/util/file';
import { parseFile } from '@/util/file';

import {
  createToolboxOperation,
  toolboxOperationKey,
} from './components/ToolboxOperation';

const message = useMessage();

const operation = createToolboxOperation();
provide(toolboxOperationKey, operation);
onBeforeUnmount(operation.dispose);

const operationPercentage = computed(() =>
  operation.state.total === 0
    ? 0
    : Math.round((operation.state.completed / operation.state.total) * 100),
);
const operationAlertType = computed(() => {
  switch (operation.state.status) {
    case 'success':
      return 'success';
    case 'failed':
      return 'error';
    case 'partial':
    case 'empty':
    case 'cancelled':
    case 'cancelling':
      return 'warning';
    default:
      return 'info';
  }
});
const operationSummary = computed(() => {
  const state = operation.state;
  switch (state.status) {
    case 'running':
      return `正在处理 ${state.completed}/${state.total}${state.currentName ? ` · ${state.currentName}` : ''}`;
    case 'cancelling':
      return '正在取消，当前文件完成后停止';
    case 'success':
      return `已完成 ${state.succeeded}/${state.total}`;
    case 'partial':
      return `部分完成：成功 ${state.succeeded}，失败 ${state.failed}`;
    case 'failed':
      return `处理失败 ${state.failed}/${state.total}`;
    case 'empty':
      return '没有符合当前工具要求的文件';
    case 'cancelled':
      return `已取消：完成 ${state.completed}/${state.total}`;
    default:
      return '';
  }
});

const files = shallowRef<ParsedFile[]>([]);

const loadFile = async (file: File) => {
  if (files.value.find((it) => it.name === file.name) !== undefined) {
    message.warning('文件已经载入');
    return;
  }
  try {
    const toolboxFile = await parseFile(file, ['txt', 'epub']);
    files.value.push(toolboxFile);
    files.value = [...files.value];
    triggerRef(files);
  } catch (e) {
    message.warning(`${e}`);
  }
};

const removeFile = (name: string) => {
  files.value = files.value.filter((it) => !(it.name === name));
  triggerRef(files);
};

const clearFile = () => {
  files.value = [];
  triggerRef(files);
};

const loadLocalFile = (volumeId: string) =>
  useLocalVolumeStore()
    .then((repo) => repo.getFile(volumeId))
    .then((file) => {
      if (file === undefined) throw '小说不存在';
      return loadFile(file.file);
    })
    .catch((error) => message.error(`文件载入失败：${error}`));

const customRequest = ({
  file,
  onFinish,
  onError,
}: UploadCustomRequestOptions) => {
  if (!file.file) return;
  loadFile(file.file)
    .then(onFinish)
    .catch((err) => {
      message.error('文件载入失败:' + err);
      onError();
    });
};

const showListModal = ref(false);
</script>

<template>
  <div class="layout-content">
    <n-h1>小说工具箱</n-h1>

    <n-flex>
      <div>
        <n-upload
          :show-file-list="false"
          accept=".txt,.epub"
          multiple
          directory-dnd
          :custom-request="customRequest"
        >
          <c-button label="加载文件" :icon="PlusOutlined" />
        </n-upload>
      </div>

      <c-button
        label="本地书架"
        :icon="PlusOutlined"
        @action="showListModal = true"
      />
      <c-button
        label="清空"
        :icon="DeleteOutlineOutlined"
        @action="clearFile"
      />
    </n-flex>

    <n-flex vertical style="margin-top: 16px">
      <n-text v-for="file of files" :key="file.name">
        <toolbox-file-card :file="file" @delete="removeFile(file.name)" />
      </n-text>
    </n-flex>

    <n-alert
      v-if="operation.state.status !== 'idle'"
      class="toolbox-operation"
      :title="operation.state.label"
      :type="operationAlertType"
      style="margin-top: 16px"
    >
      <n-flex vertical size="small">
        <n-flex align="center" justify="space-between" :wrap="false">
          <n-text>{{ operationSummary }}</n-text>
          <n-button
            v-if="operation.state.status === 'running'"
            size="small"
            @click="operation.cancel"
          >
            取消
          </n-button>
        </n-flex>
        <n-progress
          v-if="operation.state.total > 0"
          type="line"
          :percentage="operationPercentage"
          :show-indicator="false"
        />
        <n-text v-if="operation.state.failures.length > 0" depth="3">
          {{
            operation.state.failures
              .map(({ name, error }) => `${name}：${String(error)}`)
              .join('；')
          }}
        </n-text>
      </n-flex>
    </n-alert>

    <n-tabs type="segment" animated style="margin-top: 48px">
      <n-tab-pane name="0" tab="术语表">
        <toolbox-item-glossary :files="files" />
      </n-tab-pane>
      <n-tab-pane name="1" tab="EPUB：压缩图片">
        <toolbox-item-compress-image :files="files" />
      </n-tab-pane>
      <n-tab-pane name="2" tab="TXT：修复OCR换行">
        <toolbox-item-fix-ocr :files="files" />
      </n-tab-pane>
      <n-tab-pane name="3" tab="EPUB：转换成TXT">
        <toolbox-item-convert v-model:files="files" />
      </n-tab-pane>
    </n-tabs>

    <local-volume-list-katakana
      v-model:show="showListModal"
      @volume-loaded="loadLocalFile"
    />
  </div>
</template>

<style scoped>
.toolbox-operation {
  max-width: 720px;
  overflow-wrap: anywhere;
}

@media (max-width: 639px) {
  .toolbox-operation :deep(.n-alert-body__content) {
    min-width: 0;
  }
}
</style>
