<script lang="ts" setup>
import {
  AddOutlined,
  DeleteOutlineOutlined,
  RestoreOutlined,
  SearchOutlined,
  UndoOutlined,
} from '@vicons/material';
import { useDebounceFn, useMediaQuery } from '@vueuse/core';

import type {
  TxtHeadingDraft,
  TxtImportPlan,
  TxtParseMode,
  TxtSourceLine,
} from '@/model/TxtCatalog';
import {
  createTxtCatalogSession,
  getStoredTxtParseMode,
  setStoredTxtParseMode,
  TxtCatalogDraftEditor,
  type TxtCatalogPreviewSnapshot,
  type TxtCatalogSession,
} from '@/util/file';

const props = withDefaults(
  defineProps<{
    file?: File;
    submitting?: boolean;
    purpose?: 'import' | 'rebuild';
  }>(),
  { file: undefined, submitting: false, purpose: 'import' },
);
const emit = defineEmits<{
  confirm: [plan: TxtImportPlan];
  skip: [];
  cancel: [];
}>();
const show = defineModel<boolean>('show', { default: false });

const message = useMessage();
const isMobile = useMediaQuery('(max-width: 767px)');
const session = shallowRef<TxtCatalogSession>();
const snapshot = shallowRef<TxtCatalogPreviewSnapshot>();
const mode = ref<TxtParseMode>(getStoredTxtParseMode());
const headings = ref<TxtHeadingDraft[]>([]);
const editor = new TxtCatalogDraftEditor();
const minimumConfidencePercent = ref(0);
const canUndo = ref(false);
const hasManualChanges = ref(false);
const loading = ref(false);
const building = ref(false);
const busy = computed(() => building.value || props.submitting);
const progress = ref(0);
const progressMessage = ref('准备解析');
const error = ref<string>();

const LINE_HEIGHT = 38;
const LINE_WINDOW_SIZE = 120;
const LINE_OVERSCAN = 20;
const HEADING_HEIGHT = 54;
const HEADING_WINDOW_SIZE = 80;
const HEADING_OVERSCAN = 12;
const textViewport = ref<HTMLElement>();
const headingViewport = ref<HTMLElement>();
const visibleLines = shallowRef<TxtSourceLine[]>([]);
const visibleStartLine = ref(0);
const headingScrollTop = ref(0);
const selectedLine = ref(0);
const contextLines = shallowRef<TxtSourceLine[]>([]);
const searchQuery = ref('');
const searchWrapped = ref(false);
let lineRequestVersion = 0;

const totalTextHeight = computed(
  () => (snapshot.value?.lineCount ?? 0) * LINE_HEIGHT,
);
const visibleTextOffset = computed(() => visibleStartLine.value * LINE_HEIGHT);
const reviewedHeadings = computed(() =>
  headings.value.filter(
    (heading) =>
      heading.isManual ||
      heading.confidence * 100 >= minimumConfidencePercent.value,
  ),
);
const visibleHeadingStart = computed(() => {
  const requested = Math.max(
    Math.floor(headingScrollTop.value / HEADING_HEIGHT) - HEADING_OVERSCAN,
    0,
  );
  return Math.min(
    requested,
    Math.max(reviewedHeadings.value.length - HEADING_WINDOW_SIZE, 0),
  );
});
const visibleHeadings = computed(() =>
  reviewedHeadings.value.slice(
    visibleHeadingStart.value,
    visibleHeadingStart.value + HEADING_WINDOW_SIZE,
  ),
);
const totalHeadingHeight = computed(
  () => reviewedHeadings.value.length * HEADING_HEIGHT,
);
const visibleHeadingOffset = computed(
  () => visibleHeadingStart.value * HEADING_HEIGHT,
);
const selectedHeadingLines = computed(
  () => new Set(reviewedHeadings.value.map(({ lineIndex }) => lineIndex)),
);
const filteredHeadingCount = computed(
  () => headings.value.length - reviewedHeadings.value.length,
);
const summaryText = computed(() => {
  const current = snapshot.value;
  if (current === undefined) return '';
  return `${current.encoding} · ${current.lineCount.toLocaleString()} 行 · 将采用 ${reviewedHeadings.value.length.toLocaleString()} 个目录`;
});
const modeOptions: { label: string; value: TxtParseMode }[] = [
  { label: '严格', value: 'strict' },
  { label: '平衡', value: 'balanced' },
  { label: '宽松', value: 'loose' },
];
const levelOptions = Array.from({ length: 6 }, (_, index) => ({
  label: `${index + 1} 级`,
  value: index + 1,
}));
const modalTitle = computed(() =>
  props.purpose === 'rebuild' ? '重新解析 TXT 目录' : 'TXT 目录预览',
);
const confirmText = computed(() =>
  props.purpose === 'rebuild' ? '确认并完整重建' : '确认目录并导入',
);

const replaceDrafts = (drafts: readonly TxtHeadingDraft[]) => {
  editor.reset(drafts);
  canUndo.value = editor.canUndo;
  hasManualChanges.value = editor.hasManualChanges;
  headings.value = editor.snapshot;
};

const refreshHeadings = () => {
  canUndo.value = editor.canUndo;
  hasManualChanges.value = editor.hasManualChanges;
  headings.value = editor.snapshot;
};

const loadContext = async (lineIndex: number) => {
  const currentSession = session.value;
  if (currentSession === undefined) return;
  selectedLine.value = lineIndex;
  try {
    const result = await currentSession.getLines(Math.max(lineIndex - 2, 0), 5);
    contextLines.value = result.lines;
  } catch (cause) {
    if ((cause as DOMException).name !== 'AbortError')
      message.error(`无法读取上下文：${String(cause)}`);
  }
};

const requestVisibleLines = async () => {
  const currentSession = session.value;
  const viewport = textViewport.value;
  const currentSnapshot = snapshot.value;
  if (
    currentSession === undefined ||
    viewport === undefined ||
    currentSnapshot === undefined
  )
    return;
  const firstVisible = Math.floor(viewport.scrollTop / LINE_HEIGHT);
  const startLine = Math.max(firstVisible - LINE_OVERSCAN, 0);
  const requestVersion = ++lineRequestVersion;
  try {
    const result = await currentSession.getLines(startLine, LINE_WINDOW_SIZE);
    if (requestVersion !== lineRequestVersion) return;
    visibleStartLine.value = result.startLine;
    visibleLines.value = result.lines;
  } catch (cause) {
    if ((cause as DOMException).name !== 'AbortError')
      error.value = String(cause);
  }
};

const requestVisibleLinesDebounced = useDebounceFn(requestVisibleLines, 24);

const handleHeadingScroll = () => {
  headingScrollTop.value = headingViewport.value?.scrollTop ?? 0;
};

const jumpToLine = async (lineIndex: number) => {
  const currentSnapshot = snapshot.value;
  if (currentSnapshot === undefined) return;
  const target = Math.min(
    Math.max(lineIndex, 0),
    currentSnapshot.lineCount - 1,
  );
  if (textViewport.value !== undefined)
    textViewport.value.scrollTop = target * LINE_HEIGHT;
  await Promise.all([requestVisibleLines(), loadContext(target)]);
};

const toggleHeading = (line: TxtSourceLine) => {
  if (selectedHeadingLines.value.has(line.lineIndex)) {
    editor.remove(line.lineIndex);
  } else if (editor.has(line.lineIndex)) {
    editor.include(line.lineIndex);
  } else {
    editor.add(line.lineIndex, line.raw, 1);
  }
  refreshHeadings();
  void loadContext(line.lineIndex);
};

const updateHeading = (
  lineIndex: number,
  patch: Partial<Pick<TxtHeadingDraft, 'title' | 'level'>>,
) => {
  editor.update(lineIndex, patch);
  refreshHeadings();
};

const removeHeading = (lineIndex: number) => {
  editor.remove(lineIndex);
  refreshHeadings();
};

const undoDraft = () => {
  if (!editor.undo()) return;
  refreshHeadings();
};

const restoreAutomatic = () => {
  if (!editor.restoreAutomatic()) return;
  refreshHeadings();
};

const setMinimumConfidence = (value: number | null) => {
  minimumConfidencePercent.value = Math.min(Math.max(value ?? 0, 0), 100);
  headingScrollTop.value = 0;
  if (headingViewport.value !== undefined) headingViewport.value.scrollTop = 0;
};

const searchNext = async () => {
  const query = searchQuery.value.trim();
  const currentSession = session.value;
  if (query.length === 0 || currentSession === undefined) return;
  try {
    const result = await currentSession.search(
      query,
      selectedLine.value + 1,
      1,
    );
    const target = result.lineIndexes[0];
    if (target === undefined) {
      message.info('没有找到匹配文本');
      return;
    }
    searchWrapped.value = result.wrapped;
    await jumpToLine(target);
  } catch (cause) {
    message.error(`搜索失败：${String(cause)}`);
  }
};

const applyMode = async (nextMode: TxtParseMode) => {
  const currentSession = session.value;
  if (currentSession === undefined || nextMode === mode.value) return;
  loading.value = true;
  error.value = undefined;
  try {
    const nextSnapshot = await currentSession.reparse(nextMode);
    mode.value = nextMode;
    setStoredTxtParseMode(nextMode);
    snapshot.value = nextSnapshot;
    replaceDrafts(nextSnapshot.headings);
    await jumpToLine(0);
  } catch (cause) {
    if ((cause as DOMException).name !== 'AbortError')
      error.value = String(cause);
  } finally {
    loading.value = false;
  }
};

const disposeSession = () => {
  lineRequestVersion += 1;
  session.value?.dispose();
  session.value = undefined;
  snapshot.value = undefined;
  visibleLines.value = [];
  contextLines.value = [];
};

const releaseSessionDocument = () => {
  lineRequestVersion += 1;
  session.value?.dispose();
  session.value = undefined;
};

const initialize = async () => {
  const file = props.file;
  if (file === undefined) return;
  disposeSession();
  loading.value = true;
  error.value = undefined;
  progress.value = 0;
  progressMessage.value = '准备解析';
  minimumConfidencePercent.value = 0;
  const nextSession = createTxtCatalogSession();
  session.value = nextSession;
  nextSession.onProgress((nextProgress) => {
    progress.value = Math.round(nextProgress.progress * 100);
    progressMessage.value = nextProgress.message;
  });
  try {
    const nextSnapshot = await nextSession.initialize(file, mode.value);
    if (session.value !== nextSession) return;
    snapshot.value = nextSnapshot;
    replaceDrafts(nextSnapshot.headings);
    await nextTick();
    await jumpToLine(nextSnapshot.headings[0]?.lineIndex ?? 0);
    if (nextSession.kind === 'direct')
      message.warning('当前浏览器无法启动 Worker，已使用兼容解析模式');
  } catch (cause) {
    if ((cause as DOMException).name !== 'AbortError')
      error.value = String(cause);
  } finally {
    if (session.value === nextSession) loading.value = false;
  }
};

const confirmPlan = async () => {
  const currentSession = session.value;
  const currentSnapshot = snapshot.value;
  if (currentSession === undefined || currentSnapshot === undefined) return;
  const validation = editor.validate(currentSnapshot.lineCount);
  if (!validation.valid) {
    message.error(validation.errors[0] ?? '目录内容无效');
    return;
  }
  building.value = true;
  try {
    const plan = await currentSession.buildPlan(
      editor.snapshotWithMinimumConfidence(
        minimumConfidencePercent.value / 100,
      ),
    );
    releaseSessionDocument();
    emit('confirm', plan);
  } catch (cause) {
    if ((cause as DOMException).name !== 'AbortError')
      message.error(`无法生成导入计划：${String(cause)}`);
  } finally {
    building.value = false;
  }
};

const skip = () => emit('skip');
const handleShowUpdate = (nextShow: boolean) => {
  if (!nextShow && props.submitting) return;
  show.value = nextShow;
  if (!nextShow) emit('cancel');
};

watch(
  () => [show.value, props.file] as const,
  ([nextShow]) => {
    if (nextShow) void initialize();
    else disposeSession();
  },
  { immediate: true },
);

onBeforeUnmount(disposeSession);
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="modalTitle"
    :aria-label="modalTitle"
    :bordered="false"
    :auto-focus="false"
    :block-scroll="true"
    :mask-closable="false"
    :closable="!props.submitting"
    transform-origin="center"
    class="txt-catalog-modal"
    @update:show="handleShowUpdate"
  >
    <div class="txt-catalog-toolbar">
      <div>
        <div class="txt-catalog-file-name">{{ props.file?.name }}</div>
        <n-text depth="3">{{ summaryText }}</n-text>
      </div>
      <n-button-group>
        <n-popconfirm
          v-for="option in modeOptions"
          :key="option.value"
          :disabled="mode === option.value || loading || busy"
          positive-text="重新解析"
          negative-text="取消"
          @positive-click="applyMode(option.value)"
        >
          <template #trigger>
            <n-button
              :type="mode === option.value ? 'primary' : 'default'"
              :disabled="loading || busy"
            >
              {{ option.label }}
            </n-button>
          </template>
          切换识别模式会重新解析，并清除当前所有人工增删和修改。
        </n-popconfirm>
      </n-button-group>
    </div>

    <div
      v-if="loading || building"
      class="txt-catalog-progress"
      role="status"
      aria-live="polite"
    >
      <div class="txt-catalog-progress__label">
        <span>{{ building ? '正在生成目录计划' : progressMessage }}</span>
        <span>{{ progress }}%</span>
      </div>
      <n-progress
        type="line"
        :percentage="progress"
        :show-indicator="false"
        processing
      />
    </div>
    <n-alert v-else-if="error" type="error">{{ error }}</n-alert>

    <template v-if="snapshot">
      <div class="txt-catalog-review-controls">
        <n-flex align="center" :wrap="true" :size="[8, 8]">
          <span>最低置信度</span>
          <n-input-number
            class="txt-confidence-input"
            :value="minimumConfidencePercent"
            :min="0"
            :max="100"
            :step="1"
            :precision="0"
            :show-button="false"
            :disabled="loading || busy"
            :input-props="{ 'aria-label': '最低置信度' }"
            @update:value="setMinimumConfidence"
          >
            <template #suffix>%</template>
          </n-input-number>
          <n-text depth="3">
            自动目录 ≥ {{ minimumConfidencePercent }}%；人工调整始终保留
          </n-text>
          <n-text depth="3">已过滤 {{ filteredHeadingCount }} 项</n-text>
        </n-flex>
        <n-button-group>
          <n-button :disabled="!canUndo || loading || busy" @click="undoDraft">
            <template #icon><n-icon :component="UndoOutlined" /></template>
            撤回
          </n-button>
          <n-button
            :disabled="!hasManualChanges || loading || busy"
            @click="restoreAutomatic"
          >
            <template #icon><n-icon :component="RestoreOutlined" /></template>
            还原自动结果
          </n-button>
        </n-button-group>
      </div>

      <div class="txt-catalog-search">
        <n-input
          v-model:value="searchQuery"
          clearable
          placeholder="搜索正文并跳转"
          @keyup.enter="searchNext"
        >
          <template #prefix><n-icon :component="SearchOutlined" /></template>
        </n-input>
        <n-button @click="searchNext">查找下一个</n-button>
        <n-input-number
          :value="selectedLine + 1"
          :min="1"
          :max="snapshot.lineCount"
          @update:value="(value) => value !== null && jumpToLine(value - 1)"
        />
        <n-text v-if="searchWrapped" depth="3">已从文件开头继续</n-text>
      </div>

      <div v-if="contextLines.length" class="txt-catalog-context">
        <span
          v-for="line in contextLines"
          :key="line.lineIndex"
          :class="{ active: line.lineIndex === selectedLine }"
        >
          {{ line.lineIndex + 1 }}　{{ line.raw || '（空行）' }}
        </span>
      </div>

      <div class="txt-catalog-editor" :class="{ mobile: isMobile }">
        <section class="txt-catalog-panel">
          <header>
            <strong>全文</strong>
            <n-text depth="3">点击行尾按钮增删目录</n-text>
          </header>
          <div
            ref="textViewport"
            class="txt-line-viewport"
            @scroll="requestVisibleLinesDebounced"
          >
            <div
              class="txt-line-space"
              :style="{ height: `${totalTextHeight}px` }"
            >
              <div
                class="txt-visible-lines"
                :style="{ transform: `translateY(${visibleTextOffset}px)` }"
              >
                <div
                  v-for="line in visibleLines"
                  :key="line.lineIndex"
                  role="button"
                  tabindex="0"
                  class="txt-source-line"
                  :class="{
                    selected: line.lineIndex === selectedLine,
                    heading: selectedHeadingLines.has(line.lineIndex),
                  }"
                  @click="loadContext(line.lineIndex)"
                  @keyup.enter="loadContext(line.lineIndex)"
                >
                  <span class="line-number">{{ line.lineIndex + 1 }}</span>
                  <span class="line-content">{{ line.raw || ' ' }}</span>
                  <n-button
                    size="tiny"
                    quaternary
                    :disabled="loading || busy"
                    :type="
                      selectedHeadingLines.has(line.lineIndex)
                        ? 'error'
                        : 'primary'
                    "
                    @click.stop="toggleHeading(line)"
                  >
                    <template #icon>
                      <n-icon
                        :component="
                          selectedHeadingLines.has(line.lineIndex)
                            ? DeleteOutlineOutlined
                            : AddOutlined
                        "
                      />
                    </template>
                  </n-button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="txt-catalog-panel">
          <header>
            <strong>目录</strong>
            <n-text depth="3">
              {{ reviewedHeadings.length }} /
              {{ headings.length }} 项，按原文顺序排列
            </n-text>
          </header>
          <div
            ref="headingViewport"
            class="txt-heading-list"
            @scroll="handleHeadingScroll"
          >
            <div
              v-if="reviewedHeadings.length > 0"
              class="txt-heading-space"
              :style="{ height: `${totalHeadingHeight}px` }"
            >
              <div
                class="txt-visible-headings"
                :style="{ transform: `translateY(${visibleHeadingOffset}px)` }"
              >
                <div
                  v-for="heading in visibleHeadings"
                  :key="heading.lineIndex"
                  class="txt-heading-row"
                  @click="jumpToLine(heading.lineIndex)"
                >
                  <span class="heading-line">{{ heading.lineIndex + 1 }}</span>
                  <n-input
                    :value="heading.title"
                    size="small"
                    :disabled="loading || busy"
                    @click.stop
                    @update:value="
                      (title) => updateHeading(heading.lineIndex, { title })
                    "
                  />
                  <n-select
                    :value="heading.level"
                    :options="levelOptions"
                    size="small"
                    class="heading-level"
                    :disabled="loading || busy"
                    @click.stop
                    @update:value="
                      (level) => updateHeading(heading.lineIndex, { level })
                    "
                  />
                  <span class="heading-confidence">
                    {{ Math.round(heading.confidence * 100) }}%
                  </span>
                  <n-tooltip>
                    <template #trigger>
                      <n-button
                        quaternary
                        circle
                        type="error"
                        size="small"
                        :disabled="loading || busy"
                        @click.stop="removeHeading(heading.lineIndex)"
                      >
                        <template #icon>
                          <n-icon :component="DeleteOutlineOutlined" />
                        </template>
                      </n-button>
                    </template>
                    {{ heading.reasons?.join('；') || heading.rule }}
                  </n-tooltip>
                </div>
              </div>
            </div>
            <n-empty
              v-if="reviewedHeadings.length === 0"
              :description="
                headings.length === 0
                  ? '未识别目录，导入时将每 1000 行分段'
                  : '当前置信度下没有保留的目录，将每 1000 行分段'
              "
            >
              <template #extra>可在左侧正文中人工添加目录</template>
            </n-empty>
          </div>
        </section>
      </div>
    </template>

    <template #action>
      <n-flex justify="space-between" :wrap="false">
        <n-button
          v-if="props.purpose === 'import'"
          :disabled="loading || busy"
          @click="skip"
        >
          跳过此书
        </n-button>
        <span v-else />
        <n-flex :wrap="false">
          <n-button :disabled="busy" @click="handleShowUpdate(false)">
            {{ props.purpose === 'rebuild' ? '取消' : '取消批次' }}
          </n-button>
          <n-button
            type="primary"
            :loading="busy"
            :disabled="loading || busy || snapshot === undefined"
            @click="confirmPlan"
          >
            {{ confirmText }}
          </n-button>
        </n-flex>
      </n-flex>
    </template>
  </n-modal>
</template>

<style scoped>
.txt-catalog-toolbar,
.txt-catalog-review-controls,
.txt-catalog-search,
.txt-catalog-panel > header,
.txt-heading-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.txt-catalog-toolbar {
  justify-content: space-between;
  margin-bottom: 12px;
}

.txt-catalog-review-controls {
  justify-content: space-between;
  min-height: 46px;
  padding: 8px 0;
  border-bottom: 1px solid var(--n-border-color);
}

.txt-confidence-input {
  width: 104px;
}

.txt-catalog-file-name {
  max-width: min(54vw, 720px);
  overflow: hidden;
  font-size: 18px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.txt-catalog-progress {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.txt-catalog-progress__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-variant-numeric: tabular-nums;
}

.txt-catalog-search {
  margin: 12px 0;
}

.txt-catalog-search > :first-child {
  flex: 1;
}

.txt-catalog-search :deep(.n-input-number) {
  width: 132px;
}

.txt-catalog-context {
  display: grid;
  max-height: 108px;
  padding: 8px 12px;
  overflow: hidden;
  border: 1px solid var(--n-border-color);
  border-radius: 3px;
  color: var(--n-text-color-3);
  font-family: monospace;
}

.txt-catalog-context span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.txt-catalog-context .active {
  color: var(--n-text-color);
  font-weight: 600;
}

.txt-catalog-editor {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(380px, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.txt-catalog-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--n-border-color);
  border-radius: 3px;
}

.txt-catalog-panel > header {
  justify-content: space-between;
  height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid var(--n-border-color);
}

.txt-line-viewport,
.txt-heading-list {
  height: min(52vh, 560px);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-color: rgb(127 127 127 / 46%) transparent;
  scrollbar-width: thin;
}

.txt-line-viewport::-webkit-scrollbar,
.txt-heading-list::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.txt-line-viewport::-webkit-scrollbar-track,
.txt-line-viewport::-webkit-scrollbar-track-piece,
.txt-heading-list::-webkit-scrollbar-track,
.txt-heading-list::-webkit-scrollbar-track-piece {
  background: transparent;
}

.txt-line-viewport::-webkit-scrollbar-thumb,
.txt-heading-list::-webkit-scrollbar-thumb {
  background: rgb(127 127 127 / 46%);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.txt-line-viewport::-webkit-scrollbar-thumb:hover,
.txt-heading-list::-webkit-scrollbar-thumb:hover {
  background: rgb(127 127 127 / 66%);
  background-clip: padding-box;
}

.txt-line-space {
  position: relative;
}

.txt-visible-lines {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
}

.txt-source-line {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 36px;
  align-items: center;
  width: 100%;
  height: 38px;
  padding: 0 4px 0 0;
  border: 0;
  border-bottom: 1px solid var(--n-border-color);
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.txt-source-line:hover,
.txt-source-line.selected {
  background: var(--n-color-embedded);
}

.txt-source-line.heading {
  box-shadow: inset 3px 0 var(--n-primary-color);
}

.line-number,
.heading-line,
.heading-confidence {
  color: var(--n-text-color-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.line-number {
  padding-right: 12px;
}

.line-content {
  overflow: hidden;
  font-family: monospace;
  text-overflow: ellipsis;
  white-space: pre;
}

.txt-heading-list {
  position: relative;
  padding: 0 8px;
}

.txt-heading-space {
  position: relative;
}

.txt-visible-headings {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
}

.txt-heading-row {
  box-sizing: border-box;
  height: 54px;
  padding: 5px 0;
  border-bottom: 1px solid var(--n-border-color);
  cursor: pointer;
}

.heading-line {
  width: 58px;
  flex: 0 0 58px;
}

.heading-level {
  width: 88px;
  flex: 0 0 88px;
}

.heading-confidence {
  width: 42px;
  flex: 0 0 42px;
}

@media (max-width: 767px) {
  .txt-catalog-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .txt-catalog-review-controls {
    align-items: stretch;
    flex-direction: column;
  }

  .txt-catalog-review-controls > :deep(.n-button-group) {
    align-self: flex-end;
  }

  .txt-catalog-file-name {
    max-width: calc(100vw - 72px);
  }

  .txt-catalog-search {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .txt-catalog-search :deep(.n-input-number) {
    width: 100%;
  }

  .txt-catalog-editor {
    grid-template-columns: minmax(0, 1fr);
  }

  .txt-line-viewport,
  .txt-heading-list {
    height: 34vh;
    min-height: 240px;
  }

  .txt-source-line {
    grid-template-columns: 50px minmax(0, 1fr) 34px;
  }

  .txt-heading-row {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 82px 34px;
    gap: 6px;
  }

  .heading-confidence {
    display: none;
  }

  .heading-line,
  .heading-level {
    width: auto;
  }
}
</style>

<style>
.n-modal.txt-catalog-modal {
  display: flex;
  flex-direction: column;
  width: min(1280px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: hidden;
}

.txt-catalog-modal > .n-card-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.txt-catalog-modal > .n-card-header,
.txt-catalog-modal > .n-card__action {
  flex: 0 0 auto;
}

@media (max-width: 767px) {
  .n-modal.txt-catalog-modal {
    position: fixed;
    inset: 0;
    width: 100vw;
    max-width: none;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    border-radius: 0;
  }

  .txt-catalog-modal > .n-card-content {
    min-height: 0;
    padding-right: 12px;
    padding-left: 12px;
    overscroll-behavior: contain;
  }

  .txt-catalog-modal > .n-card-header {
    padding-right: 12px;
    padding-left: 12px;
  }

  .txt-catalog-modal > .n-card__action {
    padding-right: 12px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    padding-left: 12px;
  }
}
</style>
