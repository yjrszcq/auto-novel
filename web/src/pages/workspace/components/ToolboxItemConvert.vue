<script lang="ts" setup>
import type { Epub, ParsedFile, StandardTxtOptions } from '@/util/file';
import { StandardNovel } from '@/util/file';

import { Toolbox } from './Toolbox';
import { useToolboxOperation } from './ToolboxOperation';
import { truncateToolboxPreview, type ToolboxPreview } from './ToolboxPreview';

const props = defineProps<{
  files: ParsedFile[];
}>();

interface ConversionPreview {
  file: Epub;
  outputName: string;
  preview: ToolboxPreview;
  warnings: string[];
}

const operation = useToolboxOperation();
const includeChapterTitles = ref(true);
const includeVolumeTitles = ref(true);
const includeDescription = ref(false);
const previews = shallowRef<ConversionPreview[]>([]);
const previewReady = ref(false);
const epubFiles = computed(() =>
  props.files.filter((file): file is Epub => file.type === 'epub'),
);
const warningCount = computed(() =>
  previews.value.reduce((total, item) => total + item.warnings.length, 0),
);
const options = (): StandardTxtOptions => ({
  includeChapterTitles: includeChapterTitles.value,
  includeVolumeTitles: includeVolumeTitles.value,
  includeDescription: includeDescription.value,
});

const clearPreview = () => {
  previews.value = [];
  previewReady.value = false;
};

watch(
  [
    () => props.files,
    includeChapterTitles,
    includeVolumeTitles,
    includeDescription,
  ],
  clearPreview,
);

const previewConversion = async () => {
  const selectedOptions = options();
  previews.value = await Promise.all(
    epubFiles.value.map(async (file) => {
      const novel = StandardNovel.fromEpub(file);
      const output = await StandardNovel.toTxt(novel, selectedOptions);
      return {
        file,
        outputName: output.name,
        preview: truncateToolboxPreview(output.text),
        warnings: novel.warnings,
      };
    }),
  );
  previewReady.value = true;
};

const generateResults = () => {
  const files = previews.value.map(({ file }) => file);
  const selectedOptions = options();
  return operation.run('EPUB 转 TXT', files.length, (batchOptions) =>
    Toolbox.convertFiles(
      files,
      async (epub) =>
        StandardNovel.toTxt(StandardNovel.fromEpub(epub), selectedOptions),
      batchOptions,
    ),
  );
};
</script>

<template>
  <n-flex vertical size="large">
    <n-text>
      先按当前选项生成受限预览并检查目录/空章节警告，确认后才会生成独立 TXT
      结果。
    </n-text>

    <n-flex align="center">
      <n-checkbox v-model:checked="includeChapterTitles">章节标题</n-checkbox>
      <n-checkbox v-model:checked="includeVolumeTitles">卷标题</n-checkbox>
      <n-checkbox v-model:checked="includeDescription">书籍简介</n-checkbox>
      <c-button
        label="预览转换"
        size="small"
        :disabled="operation.state.busy || epubFiles.length === 0"
        @action="previewConversion"
      />
      <c-button
        label="确认生成"
        size="small"
        type="primary"
        :disabled="
          operation.state.busy || !previewReady || previews.length === 0
        "
        @action="generateResults"
      />
    </n-flex>

    <n-alert v-if="epubFiles.length === 0" type="info">
      当前选择中没有 EPUB 文件。
    </n-alert>
    <n-alert
      v-else-if="previewReady"
      :type="warningCount > 0 ? 'warning' : 'success'"
      :title="
        warningCount > 0
          ? `转换预览完成，共 ${warningCount} 条结构警告`
          : `转换预览完成，共 ${previews.length} 个文件`
      "
    >
      输出仍只存在于预览中；点击“确认生成”后才会加入处理结果。
    </n-alert>

    <n-scrollbar v-if="previewReady" class="conversion-preview">
      <n-flex vertical size="large">
        <section
          v-for="item of previews"
          :key="item.file.name"
          class="conversion-preview__file"
        >
          <n-flex align="center">
            <n-text strong>{{ item.file.name }}</n-text>
            <n-text depth="3">→ {{ item.outputName }}</n-text>
          </n-flex>
          <n-alert
            v-if="item.warnings.length > 0"
            type="warning"
            title="结构检查"
          >
            {{ item.warnings.join('；') }}
          </n-alert>
          <pre class="conversion-preview__text">{{ item.preview.text }}</pre>
          <n-text v-if="item.preview.truncated" depth="3">
            预览已截断，仅显示前 100 行或 20000 个字符。
          </n-text>
        </section>
      </n-flex>
    </n-scrollbar>
  </n-flex>
</template>

<style scoped>
.conversion-preview {
  max-height: min(58vh, 620px);
}

.conversion-preview__file {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conversion-preview__text {
  margin: 0;
  padding: 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
