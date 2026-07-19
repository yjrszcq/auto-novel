<script lang="ts" setup>
import type { ParsedFile, Txt } from '@/util/file';

import { Toolbox } from './Toolbox';
import {
  repairOcrText,
  type OcrRepairMode,
  type OcrRepairResult,
} from './ToolboxOcr';
import { useToolboxOperation } from './ToolboxOperation';

const props = defineProps<{
  files: ParsedFile[];
}>();

interface FileAnalysis {
  file: Txt;
  result: OcrRepairResult;
}

const operation = useToolboxOperation();
const themeVars = useThemeVars();
const mode = ref<OcrRepairMode>('standard');
const analysis = shallowRef<FileAnalysis[]>([]);
const analysisReady = ref(false);
const modeOptions = [
  { label: '保守', value: 'conservative' },
  { label: '标准', value: 'standard' },
  { label: '激进', value: 'aggressive' },
];
const modeDescription = computed(
  () =>
    ({
      conservative: '仅合并逗号续行和明确的英文续行，误合并风险最低。',
      standard: '合并无句末标点的常见中日韩及英文硬换行，适合大多数 OCR 文本。',
      aggressive: '还会合并冒号、分号等弱边界，仅建议在逐项检查后使用。',
    })[mode.value],
);
const txtFiles = computed(() =>
  props.files.filter((file): file is Txt => file.type === 'txt'),
);
const changedFiles = computed(() =>
  analysis.value.filter(({ result }) => result.changes.length > 0),
);
const changeCount = computed(() =>
  analysis.value.reduce(
    (total, { result }) => total + result.changes.length,
    0,
  ),
);

const clearAnalysis = () => {
  analysis.value = [];
  analysisReady.value = false;
};

watch([() => props.files, mode], clearAnalysis);

const analyze = () => {
  analysis.value = txtFiles.value.map((file) => ({
    file,
    result: repairOcrText(file.text, mode.value),
  }));
  analysisReady.value = true;
};

const generateResults = () => {
  const selectedMode = mode.value;
  const files = changedFiles.value.map(({ file }) => file);
  return operation.run('修复 OCR 换行', files.length, (options) =>
    Toolbox.modifyFiles(
      files,
      async (txt) => {
        txt.text = repairOcrText(txt.text, selectedMode).text;
      },
      options,
    ),
  );
};
</script>

<template>
  <n-flex
    vertical
    size="large"
    :style="{
      '--ocr-border': themeVars.borderColor,
      '--ocr-error': themeVars.errorColor,
      '--ocr-success': themeVars.successColor,
    }"
  >
    <n-text>
      分析疑似 OCR
      硬换行，并保护标题、列表、对话和空行边界。分析不会修改源文件；确认后才会生成独立结果。
    </n-text>

    <n-flex align="center">
      <n-text>修复强度</n-text>
      <c-radio-group v-model:value="mode" :options="modeOptions" />
      <n-text depth="3">{{ modeDescription }}</n-text>
      <c-button
        label="分析变更"
        size="small"
        :disabled="operation.state.busy || txtFiles.length === 0"
        @action="analyze"
      />
      <c-button
        label="确认生成"
        size="small"
        type="primary"
        :disabled="operation.state.busy || changedFiles.length === 0"
        @action="generateResults"
      />
    </n-flex>

    <n-alert v-if="txtFiles.length === 0" type="info">
      当前选择中没有 TXT 文件。
    </n-alert>

    <n-alert
      v-else-if="analysisReady"
      :type="changeCount > 0 ? 'warning' : 'success'"
      :title="
        changeCount > 0
          ? `预计修改 ${changeCount} 处，涉及 ${changedFiles.length} 个文件`
          : '未发现需要修复的换行'
      "
    >
      请检查下面的删除换行提案；只有点击“确认生成”才会产生结果文件。
    </n-alert>

    <n-scrollbar v-if="analysisReady && changeCount > 0" class="ocr-analysis">
      <n-flex vertical size="large">
        <section
          v-for="item of changedFiles"
          :key="item.file.name"
          class="ocr-analysis__file"
        >
          <n-text strong>
            {{ item.file.name }} · {{ item.result.changes.length }} 处
          </n-text>
          <div
            v-for="change of item.result.changes"
            :key="`${item.file.name}-${change.line}`"
            class="ocr-change"
          >
            <n-text depth="3">从第 {{ change.line }} 行开始</n-text>
            <pre class="ocr-change__before">{{ change.before }}</pre>
            <pre class="ocr-change__after">{{ change.after }}</pre>
          </div>
        </section>
      </n-flex>
    </n-scrollbar>
  </n-flex>
</template>

<style scoped>
.ocr-analysis {
  width: 100%;
  min-width: 0;
  max-width: calc(100vw - 16px);
  max-height: min(52vh, 560px);
  box-sizing: border-box;
}

.ocr-analysis__file {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.ocr-change {
  display: grid;
  min-width: 0;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--ocr-border);
  border-radius: 4px;
}

.ocr-change pre {
  margin: 0;
  padding: 8px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ocr-change__before {
  color: var(--ocr-error);
  background: color-mix(in srgb, var(--ocr-error) 8%, transparent);
  text-decoration: line-through;
}

.ocr-change__after {
  color: var(--ocr-success);
  background: color-mix(in srgb, var(--ocr-success) 8%, transparent);
}
</style>
