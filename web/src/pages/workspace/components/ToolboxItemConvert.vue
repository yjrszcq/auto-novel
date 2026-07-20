<script lang="ts" setup>
import { InfoOutlined } from '@vicons/material';
import { useMediaQuery } from '@vueuse/core';
import type { Epub, ParsedFile, StandardTxtOptions } from '@/util/file';
import { StandardNovel } from '@/util/file';

import { Toolbox } from './Toolbox';
import { useToolboxOperation } from './ToolboxOperation';
import { truncateToolboxPreview, type ToolboxPreview } from './ToolboxPreview';

const props = defineProps<{
  files: ParsedFile[];
}>();
const isMobile = useMediaQuery('(max-width: 639px)');
const showTxtToEpubHelp = ref(false);

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
let previewRequest = 0;
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
  previewRequest += 1;
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
  const request = ++previewRequest;
  const selectedOptions = options();
  const nextPreviews = await Promise.all(
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
  if (request !== previewRequest) return;
  previews.value = nextPreviews;
  previewReady.value = true;
};

onBeforeUnmount(() => {
  previewRequest += 1;
});

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
    <n-text depth="3" class="txt-to-epub-help">
      <span>关于 TXT 转 EPUB</span>
      <n-popover
        v-if="!isMobile"
        trigger="click"
        placement="bottom"
        :style="{
          maxWidth: 'min(380px, calc(100vw - 24px))',
          whiteSpace: 'normal',
        }"
      >
        <template #trigger>
          <button
            type="button"
            class="txt-to-epub-help__trigger"
            aria-label="TXT 转 EPUB 说明"
          >
            <n-icon :component="InfoOutlined" size="1em" />
          </button>
        </template>
        <div class="txt-to-epub-help__content">
          如需将 TXT 保存为 EPUB，请先在首页上传 TXT
          并确认目录，再进入该书的“编辑展示信息”，勾选“下载时保存为
          EPUB”并提交。之后下载该书时，系统会按当前下载语言设置生成 EPUB。
        </div>
      </n-popover>
      <button
        v-else
        type="button"
        class="txt-to-epub-help__trigger"
        aria-label="TXT 转 EPUB 说明"
        @click="showTxtToEpubHelp = true"
      >
        <n-icon :component="InfoOutlined" size="1em" />
      </button>
    </n-text>
    <c-modal v-model:show="showTxtToEpubHelp" title="TXT 转 EPUB">
      如需将 TXT 保存为 EPUB，请先在首页上传 TXT
      并确认目录，再进入该书的“编辑展示信息”，勾选“下载时保存为
      EPUB”并提交。之后下载该书时，系统会按当前下载语言设置生成 EPUB。
    </c-modal>

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

.txt-to-epub-help__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: inherit;
  font: inherit;
  line-height: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}

.txt-to-epub-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.txt-to-epub-help__content {
  width: min(356px, calc(100vw - 48px));
  overflow-wrap: anywhere;
  white-space: normal;
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
