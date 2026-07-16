<script lang="ts" setup>
import {
  AutoAwesomeOutlined,
  BuildOutlined,
  DarkModeOutlined,
  InfoOutlined,
  MenuBookOutlined,
  MoreVertOutlined,
  SettingsOutlined,
  WbSunnyOutlined,
} from '@vicons/material';
import type {
  ReaderAnnotation,
  ReaderBookmark,
  ReaderBookStyleOverride,
  ReaderChapterSummary,
  ReaderMode,
  ReaderSettingsRecord,
} from '@/model/Reader';
import { TranslateTaskDescriptor } from '@/model/Translator';
import { useThrottleFn } from '@vueuse/core';
import { useRouter } from 'vue-router';

import ReaderBottomSheet from './components/ReaderBottomSheet.vue';
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
import {
  getReaderEscapeAction,
  shouldToggleReaderChrome,
} from './core/ReaderChrome';
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
const migrationWarning = ref<string>();
const result = shallowRef<ReaderPageLoadResult>();
const initialSegmentId = ref<string>();
const showSettings = ref(false);
const showModePrompt = ref(false);
const showCatalog = ref(false);
const showTools = ref(false);
const showBookmarks = ref(false);
const showAnnotations = ref(false);
const controlsVisible = ref(true);
const readerRoot = ref<HTMLElement>();
const annotations = ref<ReaderAnnotation[]>([]);
const bookmarks = ref<ReaderBookmark[]>([]);
let pendingBookmark: ReaderBookmark | undefined;
const rememberModeChoice = ref(false);
const readingMode = ref<ReaderMode>('original');
const availableModes = ref<ReaderMode[]>(['original']);
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

const hasOpenReaderPanel = () =>
  showCatalog.value ||
  showSettings.value ||
  showTools.value ||
  showBookmarks.value ||
  showAnnotations.value ||
  showModePrompt.value;

const closeReaderPanels = () => {
  showCatalog.value = false;
  showSettings.value = false;
  showTools.value = false;
  showBookmarks.value = false;
  showAnnotations.value = false;
  showModePrompt.value = false;
};

const openCatalog = async () => {
  showCatalog.value = true;
  await nextTick();
  readerRoot.value
    ?.querySelector<HTMLElement>('.book-reader__catalog-item--active')
    ?.scrollIntoView({ block: 'center', behavior: 'auto' });
};

const toggleControlsFromContent = (event: MouseEvent) => {
  const selection = window.getSelection();
  const target = event.target as HTMLElement;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  if (
    shouldToggleReaderChrome({
      hasOpenPanel: hasOpenReaderPanel(),
      hasSelection: selection !== null && !selection.isCollapsed,
      interactiveTarget:
        target.closest('button, a, input, textarea, select') !== null,
      relativeX,
      width: rect.width,
    })
  ) {
    controlsVisible.value = !controlsVisible.value;
  }
};

const handleReaderKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  if (getReaderEscapeAction(hasOpenReaderPanel()) === 'close-panel') {
    closeReaderPanels();
  } else {
    controlsVisible.value = false;
  }
};

const activeSettings = computed(() => ({
  ...settings.value,
  ...bookStyle.value,
}));

const isDarkReaderTheme = computed(() => activeSettings.value.theme === 'dark');

const toggleQuickTheme = () => {
  settings.value.theme = isDarkReaderTheme.value ? 'light' : 'dark';
};

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
  migrationWarning.value = undefined;
  const repository = await repositoryPromise;
  const migration = await repository.ensureNativeEpubMigration(bookId.value);
  if (migration.status === 'failed') {
    migrationWarning.value = migration.message;
  }
  const chapterId =
    migration.status === 'migrated' && requestedChapterId.value !== undefined
      ? migration.chapterMap[requestedChapterId.value]
      : requestedChapterId.value;
  const controller = await controllerPromise;
  const loaded = await controller.load(bookId.value, chapterId);
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

const chapterSummaryById = computed(() => {
  const chapters = new Map<string, ReaderChapterSummary>();
  if (result.value?.kind === 'ready') {
    result.value.chapters.forEach((chapter) =>
      chapters.set(chapter.id, chapter),
    );
  }
  return chapters;
});

const navigateFromCatalog = (chapterId: string | undefined) => {
  if (chapterId === undefined) return;
  showCatalog.value = false;
  navigate(chapterId);
};

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
const chapterProgressPercent = computed(() => {
  if (result.value?.kind !== 'ready' || result.value.chapters.length === 0) {
    return 0;
  }
  return ((currentChapterIndex.value + 1) / result.value.chapters.length) * 100;
});

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
  window.addEventListener('keydown', handleReaderKeydown);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', saveProgressThrottled);
  window.removeEventListener('keydown', handleReaderKeydown);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  void saveProgress();
  void recordReadingTime();
  stopSpeaking();
});
</script>

<template>
  <main
    ref="readerRoot"
    class="book-reader"
    :class="[
      `book-reader--${activeSettings.theme}`,
      { 'book-reader--controls-visible': controlsVisible },
    ]"
    :style="readerStyle"
  >
    <header v-if="controlsVisible" class="book-reader__app-bar">
      <button
        class="book-reader__app-bar-action"
        type="button"
        aria-label="书籍详情"
        @click="openDetails"
      >
        <n-icon :component="InfoOutlined" />
      </button>
      <div v-if="result?.kind === 'ready'" class="book-reader__app-bar-title">
        <span :title="result.book.title">{{ result.book.title }}</span>
      </div>
      <div v-else class="book-reader__app-bar-title">本地阅读器</div>
      <button
        class="book-reader__app-bar-action"
        type="button"
        aria-label="更多阅读工具"
        @click="showTools = true"
      >
        <n-icon :component="MoreVertOutlined" />
      </button>
    </header>

    <div
      v-else-if="result?.kind === 'ready'"
      class="book-reader__chapter-status"
      :title="result.chapter.title"
    >
      {{ result.chapter.title }}
    </div>

    <section v-if="controlsVisible" class="book-reader__notices">
      <n-alert v-if="migrationWarning !== undefined" type="warning">
        {{ migrationWarning }}；现有书籍仍可继续阅读。
      </n-alert>
      <template v-if="result?.kind === 'ready'">
        <n-alert
          v-if="currentChapterSummary?.translationStatus !== 'complete'"
          type="warning"
        >
          <n-space align="center">
            <span>
              {{
                getTranslationStatusLabel(
                  currentChapterSummary.translationStatus,
                )
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

        <n-alert v-if="readingMode !== renderedMode" type="info">
          本章尚无可用译文，已显示原文。
        </n-alert>
      </template>
    </section>

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
      <article
        class="book-reader__content"
        :class="{ 'book-reader__content--controls-visible': controlsVisible }"
        @click="toggleControlsFromContent"
      >
        <ReaderSegmentLayout
          :segments="result.chapter.segments"
          :mode="renderedMode"
          :annotations="annotations"
          :initial-segment-id="initialSegmentId"
        />
      </article>
    </template>

    <nav
      v-if="controlsVisible"
      class="book-reader__bottom-navigation"
      aria-label="阅读器导航"
    >
      <button type="button" @click="openCatalog">
        <n-icon :component="MenuBookOutlined" />
        <span>目录</span>
      </button>
      <button type="button" @click="toggleQuickTheme">
        <n-icon
          :component="isDarkReaderTheme ? WbSunnyOutlined : DarkModeOutlined"
        />
        <span>{{ isDarkReaderTheme ? '白天' : '夜晚' }}</span>
      </button>
      <button type="button" @click="showSettings = true">
        <n-icon :component="SettingsOutlined" />
        <span>设置</span>
      </button>
      <button type="button" @click="showTools = true">
        <n-icon :component="BuildOutlined" />
        <span>工具</span>
      </button>
      <button type="button" @click="openSelectedInInteractive">
        <n-icon :component="AutoAwesomeOutlined" />
        <span>AI</span>
      </button>
    </nav>

    <div
      v-else-if="result?.kind === 'ready'"
      class="book-reader__progress-track"
      aria-hidden="true"
    >
      <span :style="{ width: chapterProgressPercent + '%' }" />
    </div>

    <ReaderBottomSheet v-model:show="showCatalog" title="目录" wide>
      <template v-if="result?.kind === 'ready'">
        <div class="book-reader__catalog-summary">
          <span>{{ result.book.title }}</span>
          <span>共 {{ result.chapters.length }} 章</span>
        </div>
        <div class="book-reader__catalog" role="list">
          <button
            v-for="entry in result.navigation"
            :key="entry.id"
            type="button"
            class="book-reader__catalog-item"
            :class="{
              'book-reader__catalog-item--active':
                entry.chapterId === result.chapter.chapterId,
              'book-reader__catalog-item--structural':
                entry.chapterId === undefined,
            }"
            :style="{ '--catalog-indent': `${10 + entry.level * 22}px` }"
            :disabled="entry.chapterId === undefined"
            @click="navigateFromCatalog(entry.chapterId)"
          >
            <span class="book-reader__catalog-title">{{ entry.title }}</span>
            <n-tag
              v-if="entry.chapterId !== undefined"
              size="small"
              :type="
                chapterSummaryById.get(entry.chapterId)?.translationStatus ===
                'complete'
                  ? 'success'
                  : 'default'
              "
            >
              {{
                getTranslationStatusLabel(
                  chapterSummaryById.get(entry.chapterId)?.translationStatus ??
                    'none',
                )
              }}
            </n-tag>
          </button>
        </div>
      </template>
    </ReaderBottomSheet>

    <ReaderBottomSheet v-model:show="showTools" title="阅读工具" wide>
      <div class="book-reader__tool-grid">
        <n-button @click="toggleBookmark">添加书签</n-button>
        <n-button @click="addAnnotation">高亮选中</n-button>
        <n-button
          @click="
            showTools = false;
            showAnnotations = true;
          "
        >
          批注 ({{ annotations.length }})
        </n-button>
        <n-button
          @click="
            showTools = false;
            showBookmarks = true;
          "
        >
          书签 ({{ bookmarks.length }})
        </n-button>
        <n-button
          @click="
            showTools = false;
            showModePrompt = true;
          "
        >
          阅读版本
        </n-button>
        <n-button @click="speakCurrentSegment">朗读当前段</n-button>
        <n-button @click="stopSpeaking">停止朗读</n-button>
        <n-button @click="openSelectedInInteractive">查词 / AI</n-button>
        <n-button @click="queueChapterTranslation('gpt')">
          GPT 翻译本章
        </n-button>
        <n-button @click="queueChapterTranslation('sakura')">
          Sakura 翻译本章
        </n-button>
        <n-button @click="openDetails">书籍详情</n-button>
        <n-button @click="backToWorkspace">工作区</n-button>
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
      </div>
    </ReaderBottomSheet>

    <ReaderBottomSheet v-model:show="showAnnotations" title="批注">
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
    </ReaderBottomSheet>

    <ReaderBottomSheet v-model:show="showBookmarks" title="书签">
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
            <n-button text type="error" @click.stop="deleteBookmark(bookmark)">
              删除
            </n-button>
          </template>
        </n-list-item>
      </n-list>
    </ReaderBottomSheet>

    <ReaderModeDialog
      v-model:show="showModePrompt"
      v-model:remember="rememberModeChoice"
      :modes="availableModes"
      @select="chooseMode"
    />

    <ReaderBottomSheet v-model:show="showSettings" title="阅读设置" wide>
      <n-form label-placement="top" class="book-reader__settings-grid">
        <div>
          <n-form-item label="字体大小">
            <n-slider v-model:value="settings.fontSize" :max="32" :min="12" />
          </n-form-item>
        </div>
        <div>
          <n-form-item label="行高">
            <n-slider
              v-model:value="settings.lineHeight"
              :max="2.8"
              :min="1.2"
              :step="0.1"
            />
          </n-form-item>
        </div>
        <div>
          <n-form-item label="正文宽度">
            <n-slider
              v-model:value="settings.contentWidth"
              :max="1200"
              :min="480"
              :step="20"
            />
          </n-form-item>
        </div>
        <div>
          <n-form-item label="页面边距">
            <n-slider
              v-model:value="settings.horizontalPadding"
              :max="64"
              :min="12"
              :step="2"
            />
          </n-form-item>
        </div>
        <div class="book-reader__settings-theme">
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
        </div>
      </n-form>
    </ReaderBottomSheet>
  </main>
</template>

<style scoped>
.book-reader {
  --reader-app-bar-height: 40px;
  --reader-bottom-navigation-height: 52px;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  padding-top: 24px;
  padding-bottom: 8px;
  overflow-x: hidden;
  color: var(--reader-text-color, var(--n-text-color));
  background: var(--reader-background, transparent);
}

.book-reader--controls-visible {
  padding-top: var(--reader-app-bar-height);
  padding-bottom: var(--reader-bottom-navigation-height);
}

.book-reader--light,
.book-reader--system {
  --reader-text-color: #353535;
  --reader-muted-color: #777;
  --reader-background: #fafafa;
  --reader-chrome-background: #f1f1f1;
  --reader-chrome-border: rgb(0 0 0 / 12%);
}

.book-reader--dark {
  --reader-text-color: #c9c9c9;
  --reader-muted-color: #929292;
  --reader-background: #191919;
  --reader-chrome-background: #242424;
  --reader-chrome-border: rgb(255 255 255 / 8%);
}

.book-reader--sepia {
  --reader-text-color: #4a3925;
  --reader-muted-color: #806f58;
  --reader-background: #f4ecd8;
  --reader-chrome-background: #e8ddc3;
  --reader-chrome-border: rgb(74 57 37 / 14%);
}

.book-reader__app-bar {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 100;
  display: grid;
  grid-template-columns: var(--reader-app-bar-height) minmax(0, 1fr) var(
      --reader-app-bar-height
    );
  align-items: center;
  height: var(--reader-app-bar-height);
  background: var(--reader-chrome-background, var(--reader-background));
  border-bottom: 1px solid var(--reader-chrome-border);
  box-shadow: 0 2px 8px rgb(0 0 0 / 16%);
}

.book-reader__app-bar-action {
  display: grid;
  width: 100%;
  height: 100%;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  place-items: center;
}

.book-reader__app-bar-action:hover,
.book-reader__app-bar-action:focus-visible,
.book-reader__bottom-navigation button:hover,
.book-reader__bottom-navigation button:focus-visible {
  background: rgb(127 127 127 / 14%);
  outline: none;
}

.book-reader__app-bar-title {
  min-width: 0;
  padding: 0 8px;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-reader__chapter-status {
  position: fixed;
  top: 3px;
  left: 8px;
  z-index: 20;
  max-width: calc(100vw - 24px);
  overflow: hidden;
  color: var(--reader-muted-color);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.book-reader__notices {
  display: grid;
  max-width: 1080px;
  margin: 12px auto 0;
  padding: 0 max(16px, var(--reader-padding));
  gap: 8px;
}

.book-reader__catalog {
  display: grid;
  margin-top: 8px;
  border-top: 1px solid var(--reader-chrome-border);
}

.book-reader__catalog-item--active {
  color: #5bd6b0 !important;
  background: rgb(91 214 176 / 11%) !important;
}

.book-reader__catalog-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--reader-muted-color);
  font-size: 13px;
  gap: 16px;
}

.book-reader__catalog-summary span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-reader__catalog-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 48px;
  padding: 8px 8px 8px var(--catalog-indent);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--reader-chrome-border);
  gap: 12px;
}

.book-reader__catalog-item:hover,
.book-reader__catalog-item:focus-visible {
  background: rgb(127 127 127 / 12%);
  outline: none;
}

.book-reader__catalog-item--structural {
  min-height: 38px;
  color: var(--reader-muted-color);
  font-weight: 700;
  cursor: default;
  opacity: 1;
}

.book-reader__catalog-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-reader__tool-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.book-reader__settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 32px;
}

.book-reader__settings-theme {
  grid-column: 1 / -1;
}

.book-reader__loading {
  display: grid;
  min-height: calc(100dvh - 100px);
  place-items: center;
}

.book-reader__content {
  width: min(100%, 1880px);
  margin: 0 auto;
  padding: 24px max(28px, var(--reader-padding)) 36px;
  font-size: var(--reader-font-size);
  line-height: var(--reader-line-height);
}

.book-reader__content p {
  scroll-margin-top: calc(var(--reader-app-bar-height) + 12px);
  white-space: pre-wrap;
}

.book-reader__bottom-navigation {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  justify-content: center;
  height: var(--reader-bottom-navigation-height);
  color: inherit;
  background: var(--reader-chrome-background, var(--reader-background));
  border-top: 1px solid var(--reader-chrome-border);
  box-shadow: 0 -2px 8px rgb(0 0 0 / 14%);
}

.book-reader__bottom-navigation button {
  display: flex;
  width: min(15vw, 132px);
  min-width: 76px;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  gap: 1px;
}

.book-reader__bottom-navigation :deep(.n-icon) {
  font-size: 21px;
}

.book-reader__bottom-navigation span {
  font-size: 11px;
  line-height: 14px;
}

.book-reader__progress-track {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  height: 3px;
  overflow: hidden;
  background: rgb(127 127 127 / 20%);
}

.book-reader__progress-track span {
  display: block;
  height: 100%;
  background: #5bd6b0;
  transition: width 180ms ease;
}

@media only screen and (min-width: 1000px) {
  .book-reader__content :deep(.reader-segment-layout--original),
  .book-reader__content :deep(.reader-segment-layout--translated) {
    column-count: 2;
    column-gap: clamp(72px, 9vw, 190px);
    column-rule: 1px solid var(--reader-chrome-border);
  }

  .book-reader__content :deep(.reader-segment) {
    break-inside: avoid;
  }
}

@media only screen and (max-width: 600px) {
  .book-reader {
    --reader-app-bar-height: 56px;
    --reader-bottom-navigation-height: 76px;
    padding-top: 26px;
  }

  .book-reader--controls-visible {
    padding-top: var(--reader-app-bar-height);
    padding-bottom: var(--reader-bottom-navigation-height);
  }

  .book-reader__app-bar {
    grid-template-columns: 56px minmax(0, 1fr) 56px;
  }

  .book-reader__app-bar-action :deep(.n-icon) {
    font-size: 28px;
  }

  .book-reader__app-bar-title {
    font-size: 17px;
  }

  .book-reader__chapter-status {
    top: 6px;
    left: 14px;
    max-width: calc(100vw - 28px);
    font-size: 12px;
  }

  .book-reader__notices {
    margin-top: 8px;
    padding: 0 14px;
  }

  .book-reader__content {
    padding: 18px max(22px, env(safe-area-inset-left)) 36px;
    font-size: var(--reader-font-size);
    line-height: var(--reader-line-height);
  }

  .book-reader__bottom-navigation button {
    width: 20%;
    min-width: 0;
    padding-bottom: max(5px, env(safe-area-inset-bottom));
  }

  .book-reader__bottom-navigation :deep(.n-icon) {
    font-size: 28px;
  }

  .book-reader__bottom-navigation span {
    font-size: 14px;
    line-height: 18px;
  }

  .book-reader__catalog-item {
    min-height: 54px;
  }

  .book-reader__tool-grid,
  .book-reader__settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .book-reader__settings-theme {
    grid-column: 1 / -1;
  }
}

@media (prefers-color-scheme: dark) {
  .book-reader--system {
    --reader-text-color: #c9c9c9;
    --reader-muted-color: #929292;
    --reader-background: #191919;
    --reader-chrome-background: #242424;
    --reader-chrome-border: rgb(255 255 255 / 8%);
  }
}
</style>
