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
import { Toolbox } from './components/Toolbox';

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
      return '正在取消…';
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
const selectedFileNames = ref<string[]>([]);
const selectedResultSources = ref<string[]>([]);
const selectedFiles = computed(() =>
  files.value.filter((file) => selectedFileNames.value.includes(file.name)),
);
const allFilesSelected = computed(
  () =>
    files.value.length > 0 &&
    selectedFileNames.value.length === files.value.length,
);

const setFileSelected = (name: string, selected: boolean) => {
  selectedFileNames.value = selected
    ? [...new Set([...selectedFileNames.value, name])]
    : selectedFileNames.value.filter((item) => item !== name);
};

const toggleSelectAll = () => {
  selectedFileNames.value = allFilesSelected.value
    ? []
    : files.value.map((file) => file.name);
};

watch(
  () => operation.state.outputs,
  (outputs, previousOutputs) => {
    const available = new Set(outputs.map((output) => output.sourceName));
    const previous = new Set(
      previousOutputs?.map((output) => output.sourceName) ?? [],
    );
    selectedResultSources.value = [
      ...selectedResultSources.value.filter((source) => available.has(source)),
      ...outputs
        .map((output) => output.sourceName)
        .filter((source) => !previous.has(source)),
    ];
  },
);

const selectedResults = computed(() =>
  operation.state.outputs.filter((output) =>
    selectedResultSources.value.includes(output.sourceName),
  ),
);
const allResultsSelected = computed(
  () =>
    operation.state.outputs.length > 0 &&
    selectedResultSources.value.length === operation.state.outputs.length,
);

const setResultSelected = (sourceName: string, selected: boolean) => {
  selectedResultSources.value = selected
    ? [...new Set([...selectedResultSources.value, sourceName])]
    : selectedResultSources.value.filter((item) => item !== sourceName);
};

const toggleSelectAllResults = () => {
  selectedResultSources.value = allResultsSelected.value
    ? []
    : operation.state.outputs.map((output) => output.sourceName);
};

const removeResults = (sourceNames: string[]) => {
  const removed = new Set(sourceNames);
  operation.setOutputs(
    operation.state.outputs.filter((output) => !removed.has(output.sourceName)),
  );
};

const downloadSelectedResults = async () => {
  try {
    await Toolbox.downloadFiles(selectedResults.value.map(({ file }) => file));
  } catch (error) {
    message.error(`下载失败：${error}`);
  }
};

const replaceSourcesWithResults = () => {
  if (selectedResults.value.length === 0) return;
  const nextFiles = [...files.value];
  const replacements = new Map<string, string>();

  for (const result of selectedResults.value) {
    const sourceIndex = nextFiles.findIndex(
      (file) => file.name === result.sourceName,
    );
    if (sourceIndex < 0) {
      message.error(`源文件已不存在：${result.sourceName}`);
      return;
    }
    nextFiles[sourceIndex] = result.file;
    replacements.set(result.sourceName, result.file.name);
  }

  if (new Set(nextFiles.map((file) => file.name)).size !== nextFiles.length) {
    message.error('替换后会产生同名源文件，请先移除冲突文件');
    return;
  }

  files.value = nextFiles;
  selectedFileNames.value = selectedFileNames.value.map(
    (name) => replacements.get(name) ?? name,
  );
  removeResults([...replacements.keys()]);
  triggerRef(files);
  message.success(`已替换 ${replacements.size} 个源文件`);
};

const loadFile = async (file: File) => {
  if (files.value.find((it) => it.name === file.name) !== undefined) {
    message.warning('文件已经载入');
    return;
  }
  try {
    const toolboxFile = await parseFile(file, ['txt', 'epub']);
    if (files.value.some(({ name }) => name === toolboxFile.name)) {
      message.warning('文件已经载入');
      return;
    }
    files.value.push(toolboxFile);
    files.value = [...files.value];
    setFileSelected(toolboxFile.name, true);
    triggerRef(files);
  } catch (e) {
    message.warning(`${e}`);
  }
};

const removeFile = (name: string) => {
  files.value = files.value.filter((it) => !(it.name === name));
  setFileSelected(name, false);
  triggerRef(files);
};

const clearFile = () => {
  files.value = [];
  selectedFileNames.value = [];
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

    <section v-if="files.length > 0" class="toolbox-file-section">
      <n-flex align="center" justify="space-between">
        <n-h2 style="margin: 0">源文件</n-h2>
        <n-flex align="center" size="small">
          <n-text depth="3">
            已选择 {{ selectedFiles.length }}/{{ files.length }}
          </n-text>
          <c-button
            :label="allFilesSelected ? '取消全选' : '全选'"
            size="small"
            @action="toggleSelectAll"
          />
          <c-button
            label="清空选择"
            size="small"
            :disabled="selectedFiles.length === 0"
            @action="selectedFileNames = []"
          />
        </n-flex>
      </n-flex>
      <n-flex vertical size="small">
        <toolbox-file-card
          v-for="file of files"
          :key="file.name"
          :file="file"
          :selected="selectedFileNames.includes(file.name)"
          @update:selected="setFileSelected(file.name, $event)"
          @delete="removeFile(file.name)"
        />
      </n-flex>
    </section>

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

    <section
      v-if="operation.state.outputs.length > 0"
      class="toolbox-file-section"
    >
      <n-flex align="center" justify="space-between">
        <n-h2 style="margin: 0">处理结果</n-h2>
        <n-flex align="center" size="small">
          <n-text depth="3">
            已选择 {{ selectedResults.length }}/{{
              operation.state.outputs.length
            }}
          </n-text>
          <c-button
            :label="allResultsSelected ? '取消全选' : '全选'"
            size="small"
            @action="toggleSelectAllResults"
          />
          <c-button
            label="替换源文件"
            size="small"
            :disabled="selectedResults.length === 0"
            @action="replaceSourcesWithResults"
          />
          <c-button
            label="下载所选"
            size="small"
            :disabled="selectedResults.length === 0"
            @action="downloadSelectedResults"
          />
          <c-button
            label="移除所选"
            size="small"
            :disabled="selectedResults.length === 0"
            @action="removeResults(selectedResultSources)"
          />
          <c-button
            label="清空结果"
            size="small"
            @action="operation.setOutputs([])"
          />
        </n-flex>
      </n-flex>
      <n-flex vertical size="small">
        <toolbox-file-card
          v-for="output of operation.state.outputs"
          :key="output.sourceName"
          :file="output.file"
          kind="result"
          :selected="selectedResultSources.includes(output.sourceName)"
          @update:selected="setResultSelected(output.sourceName, $event)"
          @delete="removeResults([output.sourceName])"
        />
      </n-flex>
    </section>

    <n-tabs type="segment" animated style="margin-top: 48px">
      <n-tab-pane name="0" tab="术语表">
        <toolbox-item-glossary :files="selectedFiles" />
      </n-tab-pane>
      <n-tab-pane name="1" tab="图片压缩">
        <toolbox-item-compress-image :files="selectedFiles" />
      </n-tab-pane>
      <n-tab-pane name="2" tab="OCR修复">
        <toolbox-item-fix-ocr :files="selectedFiles" />
      </n-tab-pane>
      <n-tab-pane name="3" tab="EPUB转TXT">
        <toolbox-item-convert :files="selectedFiles" />
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

.toolbox-file-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 920px;
  margin-top: 24px;
}

@media (max-width: 639px) {
  .toolbox-file-section > :first-child {
    align-items: flex-start !important;
  }

  .toolbox-operation :deep(.n-alert-body__content) {
    min-width: 0;
  }
}
</style>
