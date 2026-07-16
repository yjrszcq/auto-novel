<script lang="ts" setup>
import type {
  ReaderAnnotation,
  ReaderBookmark,
  ReaderBookStyleOverride,
  ReaderMode,
  ReaderSettingsRecord,
} from '@/model/Reader';
import { TranslateTaskDescriptor } from '@/model/Translator';
import { useThrottleFn } from '@vueuse/core';
import { useRouter } from 'vue-router';

import ReaderModeDialog from './components/ReaderModeDialog.vue';
import ReaderSegmentLayout from './components/ReaderSegmentLayout.vue';
import { createLocalVolumeReaderAdapter } from './adapters/LocalVolumeReaderAdapter';
import {
  createReaderProgress,
  resolveProgressSegment,
} from './core/ReaderProgress';
import type { ReaderPageLoadResult } from './core/ReaderPageState';
import { createReaderPageController } from './core/ReaderPageState';
import { resolveRenderedReaderMode } from './core/BilingualLayout';
import { createReaderAnnotation } from './core/ReaderAnnotations';
import { createCachedReaderContentAdapter } from './core/ReaderContentCache';
import { storeReaderInteractiveSelection } from './core/ReaderInteractiveHandoff';
import { createBrowserSpeechController } from './core/ReaderSpeech';
import { addReadingTime } from './core/ReaderStats';
import {
  createReaderBookmark,
  findBookmarkAtSegment,
  getBookmarkTarget,
  sortReaderBookmarks,
} from './core/ReaderBookmarks';
import { getAvailableReaderModes, resolveReaderMode } from './core/ReaderMode';
import {
  getChapterTranslationParams,
  getTranslationStatusLabel,
} from './core/ReaderTranslationWorkflow';
import {
  defaultReaderSettings,
  normalizeReaderSettings,
  serializeReaderSettings,
} from './core/ReaderSettings';

import {
  useGptWorkspaceStore,
  useLocalVolumeStore,
  useSakuraWorkspaceStore,
} from '@/stores';
import { useLocalVolumeManager } from '@/pages/workspace/LocalVolumeManager';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const result = shallowRef<ReaderPageLoadResult>();
const initialSegmentId = ref<string>();
const showSettings = ref(false);
const showModePrompt = ref(false);
const showBookmarks = ref(false);
const showAnnotations = ref(false);
const annotations = ref<ReaderAnnotation[]>([]);
const bookmarks = ref<ReaderBookmark[]>([]);
let pendingBookmark: ReaderBookmark | undefined;
const rememberModeChoice = ref(false);
const readingMode = ref<ReaderMode>('original');
const availableModes = ref<ReaderMode[]>(['original']);
const modeLabel = (mode: ReaderMode) =>
  ({
    ask: '每次询问',
    translated: '译文',
    'translated-original': '译文-原文',
    'original-translated': '原文-译文',
    original: '原文',
  })[mode];
let readingStartedAt: number | undefined;
let readingBookId: string | undefined;
let readingStatsWrite = Promise.resolve();
let temporaryMode: Exclude<ReaderMode, 'ask'> | undefined;
const bookStyle = ref<ReaderBookStyleOverride>();
const settings = ref<ReaderSettingsRecord>({ ...defaultReaderSettings });
const message = useMessage();
const localVolumeManager = useLocalVolumeManager();
const gptWorkspace = useGptWorkspaceStore();
const sakuraWorkspace = useSakuraWorkspaceStore();
let settingsLoaded = false;

const repositoryPromise = useLocalVolumeStore();
const controllerPromise = repositoryPromise.then((repository) =>
  createReaderPageController(
    createCachedReaderContentAdapter(
      createLocalVolumeReaderAdapter(repository),
    ),
  ),
);

const bookId = computed(() => route.params.bookId as string);
const requestedChapterId = computed(() =>
  typeof route.params.chapterId === 'string'
    ? route.params.chapterId
    : undefined,
);
const requestedSegmentId = computed(() =>
  typeof route.query.segment === 'string' ? route.query.segment : undefined,
);

const currentChapterSummary = computed(() =>
  result.value?.kind === 'ready'
    ? result.value.chapters.find(
        (chapter) => chapter.id === result.value!.chapter.chapterId,
      )
    : undefined,
);

const queueChapterTranslation = (type: 'gpt' | 'sakura') => {
  const chapter = currentChapterSummary.value;
  if (chapter === undefined) {
    return;
  }
  const results = localVolumeManager.queueJobToWorkspace(bookId.value, {
    ...getChapterTranslationParams(chapter),
    type,
    shouldTop: true,
    taskNumber: 1,
    total: result.value?.kind === 'ready' ? result.value.chapters.length : 0,
  });
  if (results.some(Boolean)) {
    message.success('已将本章翻译任务加入队列');
  } else {
    message.warning('该章节任务已在队列中');
  }
};

const taskTargetsCurrentChapter = (task: string) => {
  try {
    const { desc, params } = TranslateTaskDescriptor.parse(task);
    const chapter = currentChapterSummary.value;
    return (
      desc.type === 'local' &&
      desc.volumeId === bookId.value &&
      chapter !== undefined &&
      params.startIndex <= chapter.index &&
      chapter.index < params.endIndex
    );
  } catch {
    return false;
  }
};

const renderedMode = computed(() =>
  result.value?.kind === 'ready'
    ? resolveRenderedReaderMode(
        readingMode.value,
        result.value.chapter.segments,
      )
    : 'original',
);

const activeSettings = computed(() => ({
  ...settings.value,
  ...bookStyle.value,
}));

const readerStyle = computed(() => ({
  '--reader-font-size': `${activeSettings.value.fontSize}px`,
  '--reader-line-height': activeSettings.value.lineHeight,
  '--reader-content-width': `${activeSettings.value.contentWidth}px`,
  '--reader-padding': `${activeSettings.value.horizontalPadding}px`,
}));

const loadSettings = async () => {
  const repository = await repositoryPromise;
  settings.value = normalizeReaderSettings(
    await repository.getReaderSettings(),
  );
  settingsLoaded = true;
};

const load = async () => {
  await recordReadingTime();
  initialSegmentId.value = undefined;
  loading.value = true;
  const controller = await controllerPromise;
  const loaded = await controller.load(bookId.value, requestedChapterId.value);
  if (loaded.kind !== 'stale') {
    result.value = loaded;
  }
  loading.value = false;

  if (
    loaded.kind === 'ready' &&
    requestedChapterId.value !== loaded.chapter.chapterId
  ) {
    void router.replace(
      `/books/${encodeURIComponent(bookId.value)}/read/${encodeURIComponent(loaded.chapter.chapterId)}`,
    );
  }
  if (loaded.kind === 'ready') {
    await Promise.all([
      restoreProgress(loaded),
      resolveMode(loaded),
      loadBookmarks(loaded.book.id),
      loadAnnotations(loaded.book.id),
    ]);
    await restorePendingBookmark(loaded);
    if (requestedSegmentId.value !== undefined) {
      await nextTick();
      scrollToSegment(requestedSegmentId.value);
    }
    startReadingTime(loaded.book.id);
  }
};

const resolveMode = async (
  loaded: Extract<ReaderPageLoadResult, { kind: 'ready' }>,
) => {
  const repository = await repositoryPromise;
  const adapter = createLocalVolumeReaderAdapter(repository);
  const [preference, capabilities] = await Promise.all([
    repository.getReaderBookPreference(loaded.book.id),
    adapter.getCapabilities(loaded.book.id),
  ]);
  availableModes.value = getAvailableReaderModes(capabilities);
  readingMode.value = resolveReaderMode({
    temporaryMode,
    preference,
    settings: normalizeReaderSettings(await repository.getReaderSettings()),
    capabilities,
  });
  bookStyle.value = preference?.style;
  showModePrompt.value = readingMode.value === 'ask';
};

const chooseMode = async (mode: Exclude<ReaderMode, 'ask'>) => {
  const segmentId =
    getSegmentElements().find(
      (element) => element.getBoundingClientRect().top >= 0,
    )?.dataset.readerSegmentId ??
    getSegmentElements()[0]?.dataset.readerSegmentId;
  temporaryMode = mode;
  readingMode.value = mode;
  showModePrompt.value = false;
  await nextTick();
  getSegmentElements()
    .find((element) => element.dataset.readerSegmentId === segmentId)
    ?.scrollIntoView({ block: 'start', behavior: 'auto' });
  if (rememberModeChoice.value) {
    const repository = await repositoryPromise;
    const preference = await repository.getReaderBookPreference(bookId.value);
    await repository.putReaderBookPreference({
      ...preference,
      bookId: bookId.value,
      preferredMode: mode,
      updatedAt: Date.now(),
    });
  }
};

const getSegmentElements = () => [
  ...document.querySelectorAll<HTMLElement>('[data-reader-segment-id]'),
];

const getActiveSegmentId = () => {
  const elements = getSegmentElements();
  return (
    [...elements]
      .reverse()
      .find((element) => element.getBoundingClientRect().top <= 120)?.dataset
      .readerSegmentId ?? elements[0]?.dataset.readerSegmentId
  );
};

const scrollToSegment = (segmentId: string | undefined) => {
  if (segmentId === undefined) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  const scroll = () =>
    getSegmentElements()
      .find((element) => element.dataset.readerSegmentId === segmentId)
      ?.scrollIntoView({ block: 'start', behavior: 'auto' });
  if (
    getSegmentElements().some(
      (element) => element.dataset.readerSegmentId === segmentId,
    )
  ) {
    scroll();
    return;
  }
  initialSegmentId.value = segmentId;
  void nextTick().then(scroll);
};

const startReadingTime = (targetBookId: string) => {
  readingBookId = targetBookId;
  readingStartedAt = Date.now();
};

const recordReadingTime = async () => {
  if (readingBookId === undefined || readingStartedAt === undefined) {
    return;
  }
  const elapsedMs = Date.now() - readingStartedAt;
  const targetBookId = readingBookId;
  readingStartedAt = undefined;
  readingBookId = undefined;
  const writeReadingTime = async () => {
    try {
      const repository = await repositoryPromise;
      await repository.putReaderReadingStats(
        addReadingTime(
          await repository.getReaderReadingStats(targetBookId),
          targetBookId,
          elapsedMs,
        ),
      );
    } catch {
      // Statistics must not prevent local reading when IndexedDB is unavailable.
    }
  };
  readingStatsWrite = readingStatsWrite.then(
    writeReadingTime,
    writeReadingTime,
  );
  await readingStatsWrite;
};

const getSpeechController = () =>
  createBrowserSpeechController(
    typeof window === 'undefined' ? undefined : window.speechSynthesis,
    typeof SpeechSynthesisUtterance === 'undefined'
      ? undefined
      : (text) => new SpeechSynthesisUtterance(text),
  );

const speakCurrentSegment = () => {
  if (result.value?.kind !== 'ready') {
    return;
  }
  const segment = result.value.chapter.segments.find(
    (item) => item.id === getActiveSegmentId(),
  );
  const text =
    renderedMode.value === 'original' || segment?.translated === undefined
      ? segment?.original
      : segment.translated;
  const spoken = getSpeechController().speak(
    text ?? '',
    renderedMode.value === 'original' ? 'ja-JP' : 'zh-CN',
  );
  if (!spoken) {
    message.warning('当前浏览器不支持朗读，或没有可朗读的段落');
  }
};

const stopSpeaking = () => getSpeechController().stop();

const openSelectedInInteractive = () => {
  const text = window.getSelection()?.toString().trim() ?? '';
  if (text.length === 0) {
    message.warning('请先选择要查询的词语或文本');
    return;
  }
  if (!storeReaderInteractiveSelection(sessionStorage, text)) {
    message.warning('当前浏览器无法临时保存选中文本');
    return;
  }
  void router.push('/workspace/interactive');
};

const loadBookmarks = async (targetBookId = bookId.value) => {
  const repository = await repositoryPromise;
  const values = await repository.listReaderBookmarks(targetBookId);
  if (targetBookId === bookId.value) {
    bookmarks.value = sortReaderBookmarks(values);
  }
};

const loadAnnotations = async (targetBookId = bookId.value) => {
  const repository = await repositoryPromise;
  const values = await repository.listReaderAnnotations(targetBookId);
  if (targetBookId === bookId.value) {
    annotations.value = values;
  }
};

const getSelectedParagraph = (node: Node) =>
  (node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement
  )?.closest<HTMLElement>('p[data-reader-language-side]');

const addAnnotation = async () => {
  if (result.value?.kind !== 'ready') {
    return;
  }
  const selection = window.getSelection();
  if (selection?.rangeCount !== 1 || selection.isCollapsed) {
    message.warning('请先在同一段文字中选择要高亮的内容');
    return;
  }
  const range = selection.getRangeAt(0);
  const paragraph = getSelectedParagraph(range.startContainer);
  if (
    paragraph == null ||
    paragraph !== getSelectedParagraph(range.endContainer)
  ) {
    message.warning('批注暂时只能标记同一段文字');
    return;
  }
  const segmentId = paragraph.closest<HTMLElement>('[data-reader-segment-id]')
    ?.dataset.readerSegmentId;
  const languageSide = paragraph.dataset.readerLanguageSide;
  const quote = range.toString();
  if (
    segmentId === undefined ||
    (languageSide !== 'original' && languageSide !== 'translated') ||
    quote.length === 0
  ) {
    return;
  }
  const before = range.cloneRange();
  before.selectNodeContents(paragraph);
  before.setEnd(range.startContainer, range.startOffset);
  const startOffset = before.toString().length;
  const repository = await repositoryPromise;
  await repository.putReaderAnnotation(
    createReaderAnnotation({
      bookId: result.value.book.id,
      chapterId: result.value.chapter.chapterId,
      segmentId,
      languageSide,
      startOffset,
      endOffset: startOffset + quote.length,
      quote,
      style: 'highlight',
    }),
  );
  selection.removeAllRanges();
  await loadAnnotations(result.value.book.id);
  message.success('已添加高亮批注');
};

const deleteAnnotation = async (annotation: ReaderAnnotation) => {
  const repository = await repositoryPromise;
  await repository.deleteReaderAnnotation(annotation.id);
  await loadAnnotations(annotation.bookId);
};

const toggleBookmark = async () => {
  if (result.value?.kind !== 'ready') {
    return;
  }
  const segmentId = getActiveSegmentId();
  if (segmentId === undefined) {
    message.warning('当前章节没有可书签定位的段落');
    return;
  }
  const repository = await repositoryPromise;
  const existing = findBookmarkAtSegment(
    bookmarks.value,
    result.value.chapter.chapterId,
    segmentId,
  );
  if (existing !== undefined) {
    await repository.deleteReaderBookmark(existing.id);
    message.success('已移除书签');
  } else {
    await repository.putReaderBookmark(
      createReaderBookmark({
        bookId: result.value.book.id,
        chapterId: result.value.chapter.chapterId,
        segmentId,
        label: result.value.chapter.title,
      }),
    );
    message.success('已添加书签');
  }
  await loadBookmarks(result.value.book.id);
};

const openBookmark = (bookmark: ReaderBookmark) => {
  const target = getBookmarkTarget(bookmark);
  if (
    result.value?.kind === 'ready' &&
    result.value.chapter.chapterId === target.chapterId
  ) {
    scrollToSegment(target.segmentId);
    return;
  }
  pendingBookmark = bookmark;
  navigate(target.chapterId);
};

const deleteBookmark = async (bookmark: ReaderBookmark) => {
  const repository = await repositoryPromise;
  await repository.deleteReaderBookmark(bookmark.id);
  await loadBookmarks(bookmark.bookId);
};

const restorePendingBookmark = async (
  loaded: Extract<ReaderPageLoadResult, { kind: 'ready' }>,
) => {
  const bookmark = pendingBookmark;
  if (bookmark?.chapterId !== loaded.chapter.chapterId) {
    return;
  }
  pendingBookmark = undefined;
  await nextTick();
  scrollToSegment(bookmark.segmentId);
};

const restoreProgress = async (
  loaded: Extract<ReaderPageLoadResult, { kind: 'ready' }>,
) => {
  const repository = await repositoryPromise;
  const progress = await repository.getReaderProgress(loaded.book.id);
  if (progress?.chapterId !== loaded.chapter.chapterId) {
    return;
  }
  const segment = resolveProgressSegment(loaded.chapter.segments, progress);
  initialSegmentId.value = segment?.id;
  await nextTick();
  const element = getSegmentElements().find(
    (item) => item.dataset.readerSegmentId === segment?.id,
  );
  if (element !== undefined) {
    element.scrollIntoView({ block: 'start', behavior: 'auto' });
  } else if (progress.legacyScrollY !== undefined) {
    window.scrollTo({ top: progress.legacyScrollY, behavior: 'auto' });
  }
};

const saveProgress = async () => {
  if (result.value?.kind !== 'ready') {
    return;
  }
  const elements = getSegmentElements();
  const target =
    [...elements]
      .reverse()
      .find((element) => element.getBoundingClientRect().top <= 120) ??
    elements[0];
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const scrollRatio = scrollable <= 0 ? 0 : window.scrollY / scrollable;
  const repository = await repositoryPromise;
  await repository.putReaderProgress(
    createReaderProgress({
      bookId: result.value.book.id,
      chapterId: result.value.chapter.chapterId,
      segmentId: target?.dataset.readerSegmentId,
      scrollRatio,
    }),
  );
};

const saveProgressThrottled = useThrottleFn(() => void saveProgress(), 400);

const handleVisibilityChange = () => {
  if (document.hidden) {
    void saveProgress();
    void recordReadingTime();
  } else if (result.value?.kind === 'ready') {
    startReadingTime(result.value.book.id);
  }
};

const navigate = (chapterId: string) => {
  void saveProgress();
  void recordReadingTime();
  void router.push(
    `/books/${encodeURIComponent(bookId.value)}/read/${encodeURIComponent(chapterId)}`,
  );
};

const backToBookshelf = () => void router.push('/bookshelf');
const openDetails = () =>
  void router.push('/books/' + encodeURIComponent(bookId.value) + '/details');
const backToWorkspace = () => void router.push('/workspace/toolbox');

const currentChapterIndex = computed(() => {
  if (result.value?.kind !== 'ready') {
    return -1;
  }
  return result.value.chapters.findIndex(
    (chapter) => chapter.id === result.value!.chapter.chapterId,
  );
});
const previousChapterId = computed(() =>
  result.value?.kind === 'ready'
    ? result.value.chapters[currentChapterIndex.value - 1]?.id
    : undefined,
);
const nextChapterId = computed(() =>
  result.value?.kind === 'ready'
    ? result.value.chapters[currentChapterIndex.value + 1]?.id
    : undefined,
);

watch(
  () => [bookId.value, requestedChapterId.value],
  () => void load(),
  { immediate: true },
);
watch(
  () => [
    ...gptWorkspace.ref.value.uncompletedJobs.map((job) => job.task),
    ...sakuraWorkspace.ref.value.uncompletedJobs.map((job) => job.task),
  ],
  (tasks, previousTasks) => {
    if (
      tasks.some(
        (task) =>
          !previousTasks.includes(task) && taskTargetsCurrentChapter(task),
      )
    ) {
      void load();
    }
  },
);

watch(
  settings,
  async (value) => {
    if (!settingsLoaded) {
      return;
    }
    const repository = await repositoryPromise;
    await repository.putReaderSettings(
      serializeReaderSettings({ ...value, updatedAt: Date.now() }),
    );
  },
  { deep: true },
);

onMounted(() => {
  void loadSettings();
  window.addEventListener('scroll', saveProgressThrottled, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', saveProgressThrottled);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  void saveProgress();
  void recordReadingTime();
  stopSpeaking();
});
</script>

<template>
  <main
    class="book-reader"
    :class="`book-reader--${activeSettings.theme}`"
    :style="readerStyle"
  >
    <header class="book-reader__header">
      <n-button text @click="backToBookshelf">返回书架</n-button>
      <n-button text @click="toggleBookmark">添加书签</n-button>
      <n-button text @click="addAnnotation">高亮选中</n-button>
      <n-button text @click="showAnnotations = true">
        批注 ({{ annotations.length }})
      </n-button>
      <n-button text @click="showBookmarks = true">
        书签 ({{ bookmarks.length }})
      </n-button>
      <n-button text @click="openDetails">书籍详情</n-button>
      <n-button text @click="showSettings = true">阅读设置</n-button>
      <n-button text @click="showModePrompt = true">切换模式</n-button>
      <n-button text @click="speakCurrentSegment">朗读当前段</n-button>
      <n-button text @click="stopSpeaking">停止朗读</n-button>
      <n-button text @click="openSelectedInInteractive">查词 / AI</n-button>
      <n-button text @click="backToWorkspace">工作区</n-button>
    </header>

    <n-spin v-if="loading" size="large" class="book-reader__loading" />

    <n-result
      v-else-if="result?.kind === 'error'"
      status="error"
      title="无法打开书籍"
      :description="result.message"
    >
      <template #footer>
        <n-button @click="backToBookshelf">返回书架</n-button>
      </template>
    </n-result>

    <template v-else-if="result?.kind === 'ready'">
      <header class="book-reader__title">
        <div>
          <h1>{{ result.book.title }}</h1>
          <p>{{ result.chapter.title }}</p>
        </div>
        <n-select
          :value="result.chapter.chapterId"
          :options="
            result.chapters.map((chapter) => ({
              label: chapter.title,
              value: chapter.id,
            }))
          "
          @update:value="navigate"
        />
      </header>

      <n-alert
        v-if="currentChapterSummary?.translationStatus !== 'complete'"
        type="warning"
        style="margin-bottom: 16px"
      >
        <n-space align="center">
          <span>
            {{
              getTranslationStatusLabel(currentChapterSummary.translationStatus)
            }}
          </span>
          <n-button size="small" @click="queueChapterTranslation('gpt')">
            GPT 翻译本章
          </n-button>
          <n-button size="small" @click="queueChapterTranslation('sakura')">
            Sakura 翻译本章
          </n-button>
          <n-button size="small" @click="load">刷新本章</n-button>
        </n-space>
      </n-alert>

      <n-alert
        v-if="readingMode !== renderedMode"
        type="info"
        style="margin-bottom: 16px"
      >
        本章尚无可用译文，已显示原文。
      </n-alert>
      <article class="book-reader__content">
        <ReaderSegmentLayout
          :segments="result.chapter.segments"
          :mode="renderedMode"
          :annotations="annotations"
          :initial-segment-id="initialSegmentId"
        />
      </article>

      <footer class="book-reader__navigation">
        <n-button
          :disabled="previousChapterId === undefined"
          @click="previousChapterId && navigate(previousChapterId)"
        >
          上一章
        </n-button>
        <n-button
          :disabled="nextChapterId === undefined"
          @click="nextChapterId && navigate(nextChapterId)"
        >
          下一章
        </n-button>
      </footer>
    </template>

    <n-drawer v-model:show="showAnnotations" :width="320" placement="right">
      <n-drawer-content title="批注">
        <n-empty v-if="annotations.length === 0" description="本书还没有批注" />
        <n-list v-else>
          <n-list-item v-for="annotation in annotations" :key="annotation.id">
            <n-thing
              :title="annotation.quote"
              :description="annotation.note ?? annotation.style"
            />
            <template #suffix>
              <n-button text type="error" @click="deleteAnnotation(annotation)">
                删除
              </n-button>
            </template>
          </n-list-item>
        </n-list>
      </n-drawer-content>
    </n-drawer>

    <n-drawer v-model:show="showBookmarks" :width="320" placement="right">
      <n-drawer-content title="书签">
        <n-empty v-if="bookmarks.length === 0" description="本书还没有书签" />
        <n-list v-else hoverable clickable>
          <n-list-item
            v-for="bookmark in bookmarks"
            :key="bookmark.id"
            @click="openBookmark(bookmark)"
          >
            <n-thing
              :title="bookmark.label ?? '章节书签'"
              :description="'章节：' + bookmark.chapterId"
            />
            <template #suffix>
              <n-button
                text
                type="error"
                @click.stop="deleteBookmark(bookmark)"
              >
                删除
              </n-button>
            </template>
          </n-list-item>
        </n-list>
      </n-drawer-content>
    </n-drawer>

    <ReaderModeDialog
      v-model:show="showModePrompt"
      v-model:remember="rememberModeChoice"
      :modes="availableModes"
      @select="chooseMode"
    />

    <n-drawer v-model:show="showSettings" :width="320" placement="right">
      <n-drawer-content title="阅读设置">
        <n-form label-placement="top">
          <n-form-item label="字体大小">
            <n-slider v-model:value="settings.fontSize" :max="32" :min="12" />
          </n-form-item>
          <n-form-item label="行高">
            <n-slider
              v-model:value="settings.lineHeight"
              :max="2.8"
              :min="1.2"
              :step="0.1"
            />
          </n-form-item>
          <n-form-item label="正文宽度">
            <n-slider
              v-model:value="settings.contentWidth"
              :max="1200"
              :min="480"
              :step="20"
            />
          </n-form-item>
          <n-form-item label="页面边距">
            <n-slider
              v-model:value="settings.horizontalPadding"
              :max="64"
              :min="12"
              :step="2"
            />
          </n-form-item>
          <n-form-item label="主题">
            <n-select
              v-model:value="settings.theme"
              :options="[
                { label: '跟随系统', value: 'system' },
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' },
                { label: '护眼', value: 'sepia' },
              ]"
            />
          </n-form-item>
        </n-form>
      </n-drawer-content>
    </n-drawer>
  </main>
</template>

<style scoped>
.book-reader {
  max-width: var(--reader-content-width);
  min-height: 100vh;
  margin: 0 auto;
  padding: 24px var(--reader-padding);
  color: var(--reader-text-color, var(--n-text-color));
  background: var(--reader-background, transparent);
}

.book-reader--light {
  --reader-text-color: #1f1f1f;
  --reader-background: #fff;
}

.book-reader--dark {
  --reader-text-color: #e6e6e6;
  --reader-background: #202020;
}

.book-reader--sepia {
  --reader-text-color: #4a3925;
  --reader-background: #f4ecd8;
}

.book-reader__header {
  flex-wrap: wrap;
}

.book-reader__header,
.book-reader__navigation {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.book-reader__loading {
  display: grid;
  min-height: 50vh;
  place-items: center;
}

.book-reader__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 28px 0;
}

.book-reader__title h1,
.book-reader__title p {
  margin: 0;
}

.book-reader__title p {
  margin-top: 6px;
  color: var(--n-text-color-3);
}

.book-reader__title :deep(.n-base-selection) {
  min-width: 220px;
}

.book-reader__content {
  font-size: var(--reader-font-size);
  line-height: var(--reader-line-height);
}

.book-reader__content p {
  scroll-margin-top: 16px;
  white-space: pre-wrap;
}

.book-reader__navigation {
  margin-top: 36px;
}

@media only screen and (max-width: 600px) {
  .book-reader {
    padding-top: 16px;
    padding-bottom: 16px;
  }

  .book-reader__title {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
