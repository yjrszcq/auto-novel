<script lang="ts" setup>
import {
  ArrowBackOutlined,
  AutoAwesomeOutlined,
  BookmarkBorderOutlined,
  BookmarkOutlined,
  BuildOutlined,
  ChevronLeftOutlined,
  ChevronRightOutlined,
  DarkModeOutlined,
  InfoOutlined,
  MenuBookOutlined,
  SettingsOutlined,
  WarningAmberOutlined,
  WbSunnyOutlined,
} from '@vicons/material';
import type {
  ReaderBookmark,
  ReaderBookStyleOverride,
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderMode,
  ReaderSettingsRecord,
} from '@/model/Reader';
import type { Glossary } from '@/model/Glossary';
import type { ChapterTranslation } from '@/model/LocalVolume';
import {
  normalizeTranslationConcurrency,
  TranslateJob,
  TranslateTaskDescriptor,
} from '@/model/Translator';
import type { GptWorker, SakuraWorker } from '@/model/Translator';
import { Translator } from '@/domain/translate';
import type { TranslatorConfig } from '@/domain/translate';
import { getChapterFormalTranslationRevision } from '@/domain/translate/ChapterTranslationCompletion';
import { openAiTranslationSegmentBudget } from '@/domain/translate/TranslatorOpenAi';
import { useMediaQuery, useThrottleFn } from '@vueuse/core';
import { darkTheme, lightTheme } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import { useRouter } from 'vue-router';
import { parseFile, type ParsedFile } from '@/util/file';

import ReaderBottomSheet from './components/ReaderBottomSheet.vue';
import ReaderEpubLayout from './components/ReaderEpubLayout.vue';
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
import {
  getReaderPageDelta,
  getReaderPageMetrics,
  resolveReaderPageTurn,
  resolveReaderFlow,
} from './core/ReaderFlow';
import { createCachedReaderContentAdapter } from './core/ReaderContentCache';
import { createBrowserSpeechController } from './core/ReaderSpeech';
import type { ReaderSearchResult } from './core/ReaderSearch';
import { createReaderSearchController } from './core/ReaderSearch';
import { addReadingTime } from './core/ReaderStats';
import {
  createReaderBookmark,
  findBookmarkAtSegment,
  getBookmarkTarget,
  sortReaderBookmarks,
} from './core/ReaderBookmarks';
import {
  getAvailableReaderModes,
  getReaderDisplayTitle,
  getReaderModeLabel,
  getReaderModeShortcut,
  readerModes,
  resolveReaderMode,
} from './core/ReaderMode';
import { getTranslationStatusLabel } from './core/ReaderTranslationWorkflow';
import {
  createReaderAutomaticTranslationCache,
  getReaderAutomaticTranslationContentRevision,
  getReaderAutomaticTranslationSelectionCacheKey,
  planReaderAutomaticTranslationWindow,
  ReaderAutomaticTranslationSession,
  resolveNextReaderRetranslationChapter,
  resolveReaderAutomaticTranslationWorker,
  type ReaderAutomaticTranslationSelection,
  type ReaderAutomaticTranslationSource,
  type ReaderRetranslationOptions,
  type ReaderRetranslationScope,
  type ReaderRetranslationUntranslatedPolicy,
} from './core/ReaderAutoTranslation';
import {
  buildCompleteReaderChapterTranslation,
  ReaderAutomaticTranslationCoordinator,
} from './core/ReaderAutomaticTranslationCoordinator';
import {
  applyReaderStyleOverride,
  defaultReaderSettings,
  normalizeReaderAutoTranslationPreloadParagraphs,
  normalizeReaderSettings,
  serializeReaderSettings,
} from './core/ReaderSettings';
import {
  getReaderContinuousBufferTarget,
  planReaderContinuousBuffer,
  readerContinuousBufferSegmentBatchSize,
  type ReaderContinuousBufferDirection,
} from './core/ReaderContinuousBuffer';
import { planReaderChapterTransition } from './core/ReaderChapterTransition';
import {
  getReaderChineseScriptSides,
  readerChineseScriptService,
} from './core/ReaderChineseScript';

import {
  useGptWorkspaceStore,
  useLocalVolumeStore,
  useSakuraWorkspaceStore,
} from '@/stores';

const InteractiveTranslation = defineAsyncComponent(
  () => import('../workspace/Interactive.vue'),
);
const ToolboxItemGlossary = defineAsyncComponent(
  () => import('../workspace/components/ToolboxItemGlossary.vue'),
);

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const result = shallowRef<ReaderPageLoadResult>();
const initialSegmentId = ref<string>();
const showSettings = ref(false);
const showCatalog = ref(false);
const collapsedCatalogEntryIds = ref(new Set<string>());
const showTools = ref(false);
const showBookInfo = ref(false);
const showBookmarks = ref(false);
const showSearch = ref(false);
const showInteractiveTranslation = ref(false);
const showRetranslationSelection = ref(false);
const showRetranslationDecision = ref(false);
const retranslationScope = ref<ReaderRetranslationScope>('chapter');
const retranslationUntranslatedPolicy =
  ref<ReaderRetranslationUntranslatedPolicy>('stop');
const retranslationScopeOptions = [
  { label: '仅本章', value: 'chapter' },
  { label: '连续重翻', value: 'continuous' },
] satisfies Array<{ label: string; value: ReaderRetranslationScope }>;
const retranslationUntranslatedPolicyOptions = [
  { label: '停止', value: 'stop' },
  { label: '继续', value: 'continue' },
] satisfies Array<{
  label: string;
  value: ReaderRetranslationUntranslatedPolicy;
}>;
const showReaderGlossary = ref(false);
const readerGlossaryLoading = ref(false);
const readerGlossaryApplying = ref(false);
const clearingAutomaticTranslationCache = ref(false);
const readerGlossaryError = ref('');
const emptyReaderGlossaryFiles: ParsedFile[] = [];
const readerGlossaryInitial = shallowRef<Glossary>({});
const readerGlossaryInitialCandidateCounts = shallowRef<
  Record<string, number> | undefined
>();
const readerGlossaryInitialExcludedWords = shallowRef<string[]>([]);
const readerGlossaryEditorRevision = ref(0);
let readerGlossaryRequest = 0;
let readerGlossaryCandidateSave = Promise.resolve();
const interactiveInitialText = ref<string>();
const searchQuery = ref('');
const searchResults = shallowRef<ReaderSearchResult[]>([]);
const searchLoading = ref(false);
const searchTruncated = ref(false);
let searchUiRequestId = 0;
const showMobileTranslationNotice = ref(false);
const showMobilePreloadHelp = ref(false);
const controlsVisible = ref(true);
const selectedReaderText = ref('');
const currentTime = ref('');
let pendingInteractiveSelection = '';
let chineseScriptErrorShown = false;
const readerViewport = ref<HTMLElement | null>(null);
const readerSegments = ref<InstanceType<typeof ReaderSegmentLayout>>();
const readerPageCount = ref(1);
const readerPageIndex = ref(0);
const viewportProgressRatio = ref(0);
let paginatedAnchorSegmentId: string | undefined;
let lastScrolledLayoutAnchor:
  | { chapterId: string; segmentId: string; viewportTopOffset: number }
  | undefined;
let viewportResizeFrame: number | undefined;
const isDesktopReader = useMediaQuery('(min-width: 768px)');
const usesDoublePageSpread = useMediaQuery('(min-width: 916px)');
const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
const bookmarks = ref<ReaderBookmark[]>([]);
const viewportChapterId = ref<string>();
const viewportSegmentId = ref<string>();
let pendingBookmark: ReaderBookmark | undefined;
const readingMode = ref<ReaderMode>('original');
const availableModes = ref<ReaderMode[]>(['original']);
let readingStartedAt: number | undefined;
let readingBookId: string | undefined;
let readingStatsWrite = Promise.resolve();
let temporaryMode: ReaderMode | undefined;
const bookStyle = ref<ReaderBookStyleOverride>();
const settings = ref<ReaderSettingsRecord>({ ...defaultReaderSettings });
const message = useMessage();
const gptWorkspace = useGptWorkspaceStore();
const sakuraWorkspace = useSakuraWorkspaceStore();
let settingsLoaded = false;
let pendingChapterEdge: 'start' | 'end' | undefined;
let loadUiRequestId = 0;
const continuousChapters = shallowRef<ReaderChapterContent[]>([]);
const continuousChapterInitialSegments = new Map<string, string | undefined>();
interface ReaderChapterPreview {
  chapter: ReaderChapterContent;
  summaryIndex: number;
  start: number;
  end: number;
}
const previousChapterPreviews = shallowRef<ReaderChapterPreview[]>([]);
const nextChapterPreviews = shallowRef<ReaderChapterPreview[]>([]);
let scrolledPreviewGeneration = 0;
let scrolledPreviewFillRequest = 0;
let scrolledPreviewFillFrame: number | undefined;
let scrolledPreviewInputDirection: 'previous' | 'next' | undefined;
let scrolledPreviewInputAt = 0;
let chapterBoundaryNavigationPending = false;
let scrolledTouchStartY: number | undefined;
let scrolledTouchStartedAtTop = false;
let scrolledTouchStartedAtBottom = false;
let scrolledPreviewBoundaryFrame: number | undefined;
let pendingScrolledContentEdge:
  { chapterId: string; edge: 'start' | 'end' } | undefined;
const isSpeaking = ref(false);
const automaticTranslationSource = ref<ReaderAutomaticTranslationSource>();
const retranslationChapterId = ref<string>();
const selectedAutomaticGptWorkerId = ref<string>();
const selectedAutomaticSakuraWorkerId = ref<string>();
const automaticTranslationSession = new ReaderAutomaticTranslationSession();
let automaticTranslationController: AbortController | undefined;
let automaticTranslationTimer: number | undefined;
let automaticTranslationRunning = false;
let automaticTranslationQueued = false;
const temporaryTranslations = new Map<string, string>();
const pendingRetranslation = shallowRef<{
  bookId: string;
  selection: ReaderAutomaticTranslationSelection;
  chapterId: string;
  translation: ChapterTranslation;
  nextChapterId?: string;
}>();

const repositoryPromise = useLocalVolumeStore();
const cachedAdapterPromise = repositoryPromise.then((repository) =>
  createCachedReaderContentAdapter(createLocalVolumeReaderAdapter(repository)),
);
const searchControllerPromise = cachedAdapterPromise.then(
  createReaderSearchController,
);
const controllerPromise = cachedAdapterPromise.then(createReaderPageController);

const temporaryTranslationKey = (chapterId: string, segmentId: string) =>
  `${chapterId}\u0000${segmentId}`;

const withTemporaryTranslations = (chapter: ReaderChapterContent) => ({
  ...chapter,
  segments: chapter.segments.map((segment) => {
    const translated = temporaryTranslations.get(
      temporaryTranslationKey(chapter.chapterId, segment.id),
    );
    if (translated !== undefined) return { ...segment, translated };
    return retranslationChapterId.value === chapter.chapterId
      ? { ...segment, translated: undefined }
      : segment;
  }),
});

const hasTemporaryTranslation = (chapter: ReaderChapterContent) =>
  chapter.segments.some((segment) =>
    temporaryTranslations.has(
      temporaryTranslationKey(chapter.chapterId, segment.id),
    ),
  );

const enableTemporaryReadingModes = (chapter: ReaderChapterContent) => {
  if (!hasTemporaryTranslation(chapter)) return;
  availableModes.value = [...readerModes];
  readingMode.value = temporaryMode ?? settings.value.defaultMode;
};

const bookId = computed(() => route.params.bookId as string);
const requestedChapterId = computed(() =>
  typeof route.params.chapterId === 'string'
    ? route.params.chapterId
    : undefined,
);
const requestedSegmentId = computed(() =>
  typeof route.query.segment === 'string' ? route.query.segment : undefined,
);
const requestedEpubHref = computed(() =>
  typeof route.query.epub === 'string' ? route.query.epub : undefined,
);

const readerFlowOptions = computed(() => [
  {
    label: isDesktopReader.value ? '自动（电脑分页，手机滚动）' : '自动',
    value: 'auto',
  },
  { label: '分页', value: 'paginated' },
  { label: '滚动', value: 'scrolled' },
]);

const catalogParentIds = computed(() => {
  if (result.value?.kind !== 'ready') return new Set<string>();
  return new Set(
    result.value.navigation.flatMap(({ parentId }) =>
      parentId === undefined ? [] : [parentId],
    ),
  );
});
const visibleCatalogEntries = computed(() => {
  if (result.value?.kind !== 'ready') return [];
  const entryById = new Map(
    result.value.navigation.map((entry) => [entry.id, entry]),
  );
  return result.value.navigation.filter((entry) => {
    const visited = new Set<string>();
    let parentId = entry.parentId;
    while (parentId !== undefined && !visited.has(parentId)) {
      if (collapsedCatalogEntryIds.value.has(parentId)) return false;
      visited.add(parentId);
      parentId = entryById.get(parentId)?.parentId;
    }
    return true;
  });
});

const toggleCatalogEntry = (entryId: string) => {
  const collapsed = new Set(collapsedCatalogEntryIds.value);
  if (collapsed.has(entryId)) collapsed.delete(entryId);
  else collapsed.add(entryId);
  collapsedCatalogEntryIds.value = collapsed;
};

const currentChapterSummary = computed(() =>
  result.value?.kind === 'ready'
    ? result.value.chapters.find(
        (chapter) => chapter.id === result.value!.chapter.chapterId,
      )
    : undefined,
);
const requiresWholeChapterTranslation = computed(
  () =>
    result.value?.kind !== 'ready' ||
    result.value.book.requiresWholeChapterTranslation,
);
const chineseScriptSides = computed(() =>
  getReaderChineseScriptSides(requiresWholeChapterTranslation.value),
);
const hasIncompleteChapter = computed(
  () =>
    requiresWholeChapterTranslation.value &&
    currentChapterSummary.value !== undefined &&
    currentChapterSummary.value.translationStatus !== 'complete',
);
const currentChapterAwaitsTranslation = computed(
  () => currentChapterSummary.value?.translationStatus === 'none',
);
const showsAutomaticTranslationControls = computed(
  () =>
    hasIncompleteChapter.value ||
    automaticTranslationSource.value !== undefined,
);
const ordinaryAutomaticTranslationSource = computed(() =>
  retranslationChapterId.value === undefined
    ? automaticTranslationSource.value
    : undefined,
);
const automaticGptWorkerOptions = computed(() =>
  gptWorkspace.ref.value.workers.map((worker) => ({
    label: `${worker.model} · ${worker.endpoint}`,
    value: worker.id,
  })),
);
const automaticSakuraWorkerOptions = computed(() =>
  sakuraWorkspace.ref.value.workers.map((worker) => ({
    label: `Sakura · ${worker.endpoint}`,
    value: worker.id,
  })),
);
const readerModeOptions = computed(() =>
  readerModes.map((mode) => ({
    label: getReaderModeLabel(mode, result.value?.book.sourceLanguage),
    value: mode,
  })),
);
const currentTranslationStatusLabel = computed(() =>
  currentChapterSummary.value === undefined
    ? ''
    : getTranslationStatusLabel(currentChapterSummary.value.translationStatus),
);
const canRetranslateCurrentChapter = computed(
  () =>
    requiresWholeChapterTranslation.value &&
    currentChapterSummary.value !== undefined &&
    currentChapterSummary.value.translationStatus !== 'none',
);

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

const displayReaderTitle = (entry: {
  title: string;
  translatedTitle?: string;
}) => getReaderDisplayTitle(entry, readingMode.value);

const getChapterRenderedMode = (chapter: ReaderChapterContent) =>
  resolveRenderedReaderMode(readingMode.value, chapter.segments);

const hasOpenReaderPanel = () =>
  showCatalog.value ||
  showSettings.value ||
  showTools.value ||
  showBookInfo.value ||
  showBookmarks.value ||
  showSearch.value ||
  showInteractiveTranslation.value ||
  showRetranslationSelection.value ||
  showRetranslationDecision.value ||
  showReaderGlossary.value ||
  showMobileTranslationNotice.value;

const closeReaderPanels = () => {
  if (showRetranslationDecision.value && pendingRetranslation.value) {
    void applyRetranslationDecision(false);
  }
  showCatalog.value = false;
  showSettings.value = false;
  showTools.value = false;
  showBookInfo.value = false;
  showBookmarks.value = false;
  showSearch.value = false;
  showInteractiveTranslation.value = false;
  showRetranslationSelection.value = false;
  if (pendingRetranslation.value === undefined) {
    showRetranslationDecision.value = false;
  }
  showReaderGlossary.value = false;
  showMobileTranslationNotice.value = false;
};

const openCatalog = async () => {
  const shouldOpen = !showCatalog.value;
  closeReaderPanels();
  if (!shouldOpen) return;
  showCatalog.value = true;
  await nextTick();
  document
    .querySelector<HTMLElement>('.book-reader__catalog-item--active')
    ?.scrollIntoView({ block: 'center', behavior: 'auto' });
};

const openSettings = () => {
  const shouldOpen = !showSettings.value;
  closeReaderPanels();
  showMobilePreloadHelp.value = false;
  showSettings.value = shouldOpen;
};

const openTools = () => {
  const shouldOpen = !showTools.value;
  closeReaderPanels();
  showTools.value = shouldOpen;
};

const openReaderGlossary = async () => {
  const request = ++readerGlossaryRequest;
  showTools.value = false;
  showReaderGlossary.value = true;
  readerGlossaryLoading.value = true;
  readerGlossaryError.value = '';
  try {
    const repository = await repositoryPromise;
    const volume = await repository.getVolume(bookId.value);
    if (volume === undefined) throw new Error('小说不存在');
    if (request !== readerGlossaryRequest || !showReaderGlossary.value) return;
    readerGlossaryInitial.value = { ...volume.glossary };
    readerGlossaryInitialCandidateCounts.value =
      volume.glossaryCandidateCounts === undefined
        ? undefined
        : { ...volume.glossaryCandidateCounts };
    readerGlossaryInitialExcludedWords.value = [
      ...(volume.glossaryExcludedWords ?? []),
    ];
    readerGlossaryEditorRevision.value += 1;
  } catch (reason) {
    if (request === readerGlossaryRequest && showReaderGlossary.value) {
      readerGlossaryError.value = String(reason);
    }
  } finally {
    if (request === readerGlossaryRequest) {
      readerGlossaryLoading.value = false;
    }
  }
};

const loadReaderGlossaryFiles = async () => {
  const repository = await repositoryPromise;
  const stored = await repository.getFile(bookId.value);
  if (stored === undefined) throw new Error('原始书籍文件不存在');
  return [await parseFile(stored.file)];
};

const saveReaderGlossaryCandidates = (
  candidateCounts: Record<string, number>,
) => {
  readerGlossaryCandidateSave = readerGlossaryCandidateSave.then(async () => {
    try {
      const repository = await repositoryPromise;
      await repository.updateGlossaryCandidates(bookId.value, candidateCounts);
      readerGlossaryInitialCandidateCounts.value = { ...candidateCounts };
    } catch (reason) {
      message.error(`无法保存扫描结果：${String(reason)}`);
    }
  });
  return readerGlossaryCandidateSave;
};

const applyReaderGlossary = async (
  glossary: Glossary,
  excludedWords: string[],
) => {
  if (readerGlossaryApplying.value) return;
  readerGlossaryApplying.value = true;
  try {
    const anchor = captureReaderPosition();
    await saveProgress();
    stopAutomaticTranslation(false, false);
    automaticTranslationSession.clearDrafts();
    temporaryTranslations.clear();
    await readerGlossaryCandidateSave;
    const repository = await repositoryPromise;
    await repository.updateGlossary(bookId.value, glossary, excludedWords);
    await repository.deleteReaderAutomaticTranslationCaches({
      bookId: bookId.value,
    });
    const adapter = await cachedAdapterPromise;
    adapter.invalidateChapter({ bookId: bookId.value });
    showReaderGlossary.value = false;
    await load();
    await nextTick();
    restoreReaderPosition(anchor);
    message.success('术语表已应用，未完成的自动翻译缓存已清除');
  } catch (reason) {
    message.error(`无法应用术语表：${String(reason)}`);
  } finally {
    readerGlossaryApplying.value = false;
  }
};

const clearReaderAutomaticTranslationCache = async () => {
  if (clearingAutomaticTranslationCache.value) return;
  clearingAutomaticTranslationCache.value = true;
  try {
    const anchor = captureReaderPosition();
    await saveProgress();
    stopAutomaticTranslation(false, false);
    automaticTranslationSession.clearDrafts();
    temporaryTranslations.clear();
    const repository = await repositoryPromise;
    const deleted = await repository.deleteReaderAutomaticTranslationCaches({
      bookId: bookId.value,
    });
    const adapter = await cachedAdapterPromise;
    adapter.invalidateBook?.(bookId.value);
    await load();
    await nextTick();
    restoreReaderPosition(anchor);
    message.success(
      deleted > 0 ? `已清除 ${deleted} 条翻译缓存` : '没有可清除的翻译缓存',
    );
  } catch (reason) {
    message.error(`清除翻译缓存失败：${String(reason)}`);
  } finally {
    clearingAutomaticTranslationCache.value = false;
  }
};

const openSearch = () => {
  showTools.value = false;
  showSearch.value = true;
};

const runSearch = async () => {
  const query = searchQuery.value.trim();
  const requestId = ++searchUiRequestId;
  if (result.value?.kind !== 'ready' || query.length === 0) {
    const controller = await searchControllerPromise;
    controller.cancel();
    searchResults.value = [];
    searchTruncated.value = false;
    searchLoading.value = false;
    return;
  }
  searchLoading.value = true;
  try {
    const controller = await searchControllerPromise;
    const bookId = result.value.book.id;
    const response = await controller.search({
      bookId,
      chapters: result.value.chapters,
      query,
      excerptScript: activeSettings.value.chineseScript,
    });
    if (response.kind === 'stale' || requestId !== searchUiRequestId) return;
    searchResults.value = response.results;
    searchTruncated.value = response.truncated;
  } catch (reason) {
    if (requestId === searchUiRequestId) {
      message.error('搜索失败：' + String(reason));
    }
  } finally {
    if (requestId === searchUiRequestId) {
      searchLoading.value = false;
    }
  }
};

const openSearchResult = (searchResult: ReaderSearchResult) => {
  showSearch.value = false;
  if (
    result.value?.kind === 'ready' &&
    result.value.chapter.chapterId === searchResult.chapterId
  ) {
    scrollToSegment(searchResult.segmentId);
    return;
  }
  void router.push({
    path: `/books/${encodeURIComponent(bookId.value)}/read/${encodeURIComponent(searchResult.chapterId)}`,
    query: { segment: searchResult.segmentId },
  });
};

const updateViewportMetrics = () => {
  viewportSegmentId.value = getActiveSegmentId();
  viewportChapterId.value =
    (resolvedFlow.value === 'scrolled'
      ? getActiveContinuousChapterElement()?.dataset.readerChapterId
      : undefined) ??
    (result.value?.kind === 'ready'
      ? result.value.chapter.chapterId
      : undefined);
  if (resolvedFlow.value === 'paginated' && readerViewport.value !== null) {
    const metrics = getReaderPageMetrics(readerViewport.value);
    readerPageCount.value = metrics.pageCount;
    readerPageIndex.value = metrics.pageIndex;
    viewportProgressRatio.value = metrics.ratio;
    return;
  }
  readerPageCount.value = 1;
  readerPageIndex.value = 0;
  const activeChapter = getActiveContinuousChapterElement();
  if (resolvedFlow.value === 'scrolled' && activeChapter !== undefined) {
    const rect = activeChapter.getBoundingClientRect();
    const visibleTop = getReaderVisibleTop();
    const visibleBottom = getReaderVisibleBottom();
    const readableDistance = Math.max(
      1,
      rect.height - (visibleBottom - visibleTop),
    );
    viewportProgressRatio.value = Math.max(
      0,
      Math.min(1, (visibleTop - rect.top) / readableDistance),
    );
    rememberScrolledLayoutAnchor();
    return;
  }
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  viewportProgressRatio.value =
    scrollable <= 0 ? 0 : Math.max(0, Math.min(1, window.scrollY / scrollable));
};

const resetPaginatedVerticalPosition = (viewport: HTMLElement) => {
  window.scrollTo({ top: 0, behavior: 'auto' });
  viewport.scrollTop = 0;
};

const positionReaderPage = (viewport: HTMLElement, pageIndex: number) => {
  viewport.style.setProperty('--reader-page-tail-space', '0px');
  const targetLeft = Math.max(0, pageIndex) * viewport.clientWidth;
  resetPaginatedVerticalPosition(viewport);
  viewport.scrollTo({ top: 0, left: targetLeft, behavior: 'auto' });
  const missingTailSpace = Math.max(0, targetLeft - viewport.scrollLeft);
  if (missingTailSpace <= 0) return;
  viewport.style.setProperty(
    '--reader-page-tail-start',
    `${viewport.scrollWidth}px`,
  );
  viewport.style.setProperty(
    '--reader-page-tail-space',
    `${missingTailSpace}px`,
  );
  void viewport.scrollWidth;
  viewport.scrollTo({ top: 0, left: targetLeft, behavior: 'auto' });
};

const scrollReaderPage = async (delta: number) => {
  const viewport = readerViewport.value;
  if (resolvedFlow.value !== 'paginated' || viewport === null) return;
  const metrics = getReaderPageMetrics(viewport);
  const turn = resolveReaderPageTurn({
    pageIndex: metrics.pageIndex,
    pageCount: metrics.pageCount,
    delta,
    hasPreviousSegments: readerSegments.value?.hasPreviousSegments() ?? false,
    hasMoreSegments: readerSegments.value?.hasMoreSegments() ?? false,
    hasPreviousChapter: previousChapterId.value !== undefined,
    hasNextChapter: nextChapterId.value !== undefined,
  });
  if (turn.kind === 'chapter') {
    const chapterId =
      turn.direction === 'previous'
        ? previousChapterId.value
        : nextChapterId.value;
    if (chapterId !== undefined) {
      navigate(chapterId, turn.direction === 'previous' ? 'end' : 'start');
    }
    return;
  }
  if (turn.kind === 'segments') {
    const anchorPage = metrics.pageIndex;
    const anchorSegmentId = getActiveSegmentId('paginated');
    if (turn.direction === 'previous') {
      await readerSegments.value?.loadPreviousSegments();
    } else {
      await readerSegments.value?.loadMoreSegments();
    }
    await nextTick();
    const expandedMetrics = getReaderPageMetrics(viewport);
    const expandedAnchorPage = getSegmentPageIndex(viewport, anchorSegmentId);
    const pageIndex = Math.max(
      0,
      Math.min(
        expandedMetrics.pageCount - 1,
        turn.direction === 'previous'
          ? (expandedAnchorPage ?? anchorPage) - 1
          : (expandedAnchorPage ?? anchorPage) + 1,
      ),
    );
    positionReaderPage(viewport, pageIndex);
    await nextTick();
    paginatedAnchorSegmentId = getActiveSegmentId('paginated');
    updateViewportMetrics();
    await saveProgress();
    return;
  }
  if (turn.kind !== 'page') return;
  positionReaderPage(viewport, turn.pageIndex);
  await nextTick();
  paginatedAnchorSegmentId = getActiveSegmentId('paginated');
  updateViewportMetrics();
  await saveProgress();
};

let lastWheelPageAt = 0;
const handleViewportWheel = (event: WheelEvent) => {
  if (resolvedFlow.value === 'scrolled') {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const direction = event.deltaY < 0 ? 'previous' : 'next';
    scrolledPreviewInputDirection = direction;
    scrolledPreviewInputAt = performance.now();
    if (
      (direction === 'previous' && previousChapterPreviews.value.length > 0) ||
      (direction === 'next' && nextChapterPreviews.value.length > 0)
    ) {
      scheduleScrolledPreviewBoundarySync();
      return;
    }
    if (navigateScrolledChapterBoundary(direction)) {
      event.preventDefault();
    }
    return;
  }
  if (
    resolvedFlow.value !== 'paginated' ||
    Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  ) {
    return;
  }
  event.preventDefault();
  const now = Date.now();
  if (now - lastWheelPageAt < 240) return;
  lastWheelPageAt = now;
  void scrollReaderPage(event.deltaY < 0 ? -1 : 1);
};

const handleViewportTouchStart = (event: TouchEvent) => {
  if (resolvedFlow.value !== 'scrolled' || event.touches.length !== 1) return;
  scrolledTouchStartY = event.touches[0]?.clientY;
  scrolledTouchStartedAtTop = window.scrollY <= 2;
  scrolledTouchStartedAtBottom =
    window.scrollY + window.innerHeight >=
    document.documentElement.scrollHeight - 2;
};

const handleViewportTouchMove = (event: TouchEvent) => {
  const currentY = event.touches[0]?.clientY;
  if (
    resolvedFlow.value !== 'scrolled' ||
    scrolledTouchStartY === undefined ||
    currentY === undefined
  ) {
    return;
  }
  const delta = scrolledTouchStartY - currentY;
  if (Math.abs(delta) > 8) {
    scrolledPreviewInputDirection = delta < 0 ? 'previous' : 'next';
    scrolledPreviewInputAt = performance.now();
    scheduleScrolledPreviewBoundarySync();
  }
  const direction =
    delta > 48 &&
    scrolledTouchStartedAtBottom &&
    nextChapterPreviews.value.length === 0
      ? 'next'
      : delta < -48 &&
          scrolledTouchStartedAtTop &&
          previousChapterPreviews.value.length === 0
        ? 'previous'
        : undefined;
  if (direction !== undefined && navigateScrolledChapterBoundary(direction)) {
    event.preventDefault();
  }
};

const handleViewportTouchEnd = () => {
  scrolledTouchStartY = undefined;
  scrolledTouchStartedAtTop = false;
  scrolledTouchStartedAtBottom = false;
};

const handleViewportScroll = () => {
  if (resolvedFlow.value === 'scrolled') {
    syncScrolledPreviewBoundary();
  }
  updateViewportMetrics();
  saveProgressThrottled();
};

const handleViewportResize = () => {
  const scrolledAnchor = lastScrolledLayoutAnchor;
  if (viewportResizeFrame !== undefined) {
    cancelAnimationFrame(viewportResizeFrame);
  }
  viewportResizeFrame = requestAnimationFrame(() => {
    viewportResizeFrame = undefined;
    if (resolvedFlow.value !== 'paginated') {
      restoreScrolledLayoutAnchor(scrolledAnchor);
      updateViewportMetrics();
      scheduleCurrentContinuousPreviewFill();
      return;
    }
    scrollToSegment(paginatedAnchorSegmentId);
    requestAnimationFrame(updateViewportMetrics);
  });
};

const toggleControlsFromContent = (event: MouseEvent) => {
  const selection = window.getSelection();
  const target = event.target as HTMLElement;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  const hasSelection = selection !== null && !selection.isCollapsed;
  const interactiveTarget =
    target.closest('button, a, input, textarea, select') !== null;
  if (
    resolvedFlow.value === 'paginated' &&
    !hasOpenReaderPanel() &&
    !hasSelection &&
    !interactiveTarget
  ) {
    if (relativeX < rect.width * 0.25) {
      void scrollReaderPage(-1);
      return;
    }
    if (relativeX > rect.width * 0.75) {
      void scrollReaderPage(1);
      return;
    }
  }
  if (
    shouldToggleReaderChrome({
      hasOpenPanel: hasOpenReaderPanel(),
      hasSelection,
      interactiveTarget,
      relativeX,
      width: rect.width,
    })
  ) {
    controlsVisible.value = !controlsVisible.value;
  }
};

const updateReaderSelection = () => {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (selection === null || selection.isCollapsed || text.length === 0) {
    selectedReaderText.value = '';
    return;
  }
  const anchor = selection.anchorNode;
  const root = anchor?.getRootNode();
  const selectionHost =
    root instanceof ShadowRoot ? root.host : anchor?.parentElement;
  if (
    selectionHost instanceof Element &&
    selectionHost.closest('.book-reader__content') !== null
  ) {
    selectedReaderText.value = text;
    controlsVisible.value = true;
  }
};

const captureInteractiveSelection = () => {
  pendingInteractiveSelection =
    window.getSelection()?.toString().trim() || selectedReaderText.value;
};

const handleReaderKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (getReaderEscapeAction(hasOpenReaderPanel()) === 'close-panel') {
      closeReaderPanels();
    } else {
      controlsVisible.value = false;
    }
    return;
  }
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing
  )
    return;
  const target = event.target;
  const isInteractiveTarget =
    target instanceof Element &&
    target.closest(
      'input, textarea, select, a, [contenteditable="true"], [role="textbox"]',
    ) !== null;
  if (hasOpenReaderPanel() || isInteractiveTarget) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (event.repeat) return;
    const previous = event.key === 'ArrowLeft';
    const chapterId = previous ? previousChapterId.value : nextChapterId.value;
    if (chapterId !== undefined) {
      event.preventDefault();
      navigate(chapterId, previous ? 'end' : 'start');
    }
    return;
  }
  const mode = getReaderModeShortcut(event.key);
  if (
    mode !== undefined &&
    !event.repeat &&
    result.value?.kind === 'ready' &&
    availableModes.value.includes(mode)
  ) {
    event.preventDefault();
    void chooseMode(mode);
    return;
  }
  const pageDelta = getReaderPageDelta(event.key);
  if (resolvedFlow.value === 'paginated' && pageDelta !== 0) {
    event.preventDefault();
    void scrollReaderPage(pageDelta);
  }
};

const activeSettings = computed(() =>
  applyReaderStyleOverride(settings.value, bookStyle.value),
);

const resolvedFlow = computed(() =>
  resolveReaderFlow(settings.value.flow, isDesktopReader.value),
);

const isDarkReaderTheme = computed(
  () =>
    activeSettings.value.theme === 'dark' ||
    activeSettings.value.theme === 'ultra-dark' ||
    (activeSettings.value.theme === 'system' && systemPrefersDark.value),
);

const readerNaiveTheme = computed(() =>
  isDarkReaderTheme.value ? darkTheme : lightTheme,
);

const resolvedReaderTheme = computed(() =>
  activeSettings.value.theme === 'sepia'
    ? 'sepia'
    : activeSettings.value.theme === 'ultra-dark'
      ? 'ultra-dark'
      : isDarkReaderTheme.value
        ? 'dark'
        : 'light',
);

const sepiaNaiveThemeOverrides: GlobalThemeOverrides = {
  common: {
    baseColor: '#f4ecd8',
    bodyColor: '#f4ecd8',
    cardColor: '#eee3c8',
    modalColor: '#eee3c8',
    popoverColor: '#f0e5cb',
    inputColor: '#f0e5cb',
    actionColor: '#e8ddc3',
    hoverColor: '#e3d5b7',
    pressedColor: '#d9c8a5',
    borderColor: '#aa9978',
    dividerColor: 'rgb(74 57 37 / 14%)',
    railColor: '#c7b99a',
    textColorBase: '#4a3925',
    textColor1: '#4a3925',
    textColor2: '#5f4b32',
    textColor3: '#806f58',
    placeholderColor: '#8f7e65',
    iconColor: '#806f58',
  },
  Button: {
    color: 'transparent',
    colorHover: '#e8ddc3',
    colorPressed: '#dfd1b2',
    colorFocus: '#e8ddc3',
    textColor: '#4a3925',
    textColorHover: '#4a3925',
    textColorPressed: '#4a3925',
    textColorFocus: '#4a3925',
    border: '1px solid #9d8b6c',
    borderHover: '1px solid #806f58',
    borderPressed: '1px solid #806f58',
    borderFocus: '1px solid #806f58',
  },
  Tag: {
    color: '#e4d7b8',
    colorBordered: '#e4d7b8',
    border: '1px solid #b7a583',
    textColor: '#4a3925',
  },
  Slider: {
    railColor: '#c7b99a',
    railColorHover: '#b7a786',
  },
  Select: {
    peers: {
      InternalSelection: {
        color: '#f0e5cb',
        colorActive: '#f0e5cb',
        textColor: '#4a3925',
        arrowColor: '#806f58',
        border: '1px solid #aa9978',
        borderHover: '1px solid #806f58',
        peers: {
          Popover: {
            color: '#f0e5cb',
            textColor: '#4a3925',
            dividerColor: 'rgb(74 57 37 / 14%)',
          },
        },
      },
      InternalSelectMenu: {
        color: '#f0e5cb',
        optionTextColor: '#4a3925',
        optionTextColorPressed: '#4a3925',
        optionTextColorActive: '#129b6c',
        optionColorPending: '#e3d5b7',
        optionColorActive: '#e4ddc3',
        optionColorActivePending: '#ddd0b1',
      },
    },
  },
};

const ultraDarkNaiveThemeOverrides: GlobalThemeOverrides = {
  common: {
    baseColor: '#000000',
    bodyColor: '#000000',
    cardColor: '#050505',
    modalColor: '#050505',
    popoverColor: '#080808',
    inputColor: '#0b0b0b',
    actionColor: '#0d0d0d',
    hoverColor: '#111111',
    pressedColor: '#161616',
    borderColor: '#202020',
    dividerColor: '#181818',
    railColor: '#181818',
    primaryColor: '#356f5e',
    primaryColorHover: '#427f6c',
    primaryColorPressed: '#2c5d4f',
    textColorBase: '#4b4b4b',
    textColor1: '#555555',
    textColor2: '#4b4b4b',
    textColor3: '#3d3d3d',
    placeholderColor: '#353535',
    iconColor: '#4b4b4b',
  },
  Button: {
    color: 'transparent',
    colorHover: '#0d0d0d',
    colorPressed: '#111111',
    colorFocus: '#0d0d0d',
    textColor: '#4b4b4b',
    textColorHover: '#5a5a5a',
    textColorPressed: '#5a5a5a',
    textColorFocus: '#5a5a5a',
    border: '1px solid #202020',
    borderHover: '1px solid #2b2b2b',
    borderPressed: '1px solid #2b2b2b',
    borderFocus: '1px solid #2b2b2b',
  },
  Tag: {
    color: '#090909',
    colorBordered: '#090909',
    border: '1px solid #202020',
    textColor: '#4b4b4b',
  },
  Slider: {
    railColor: '#181818',
    railColorHover: '#202020',
    fillColor: '#25493f',
    fillColorHover: '#2d574b',
    handleColor: '#242424',
    handleBoxShadow: '0 0 0 1px #303030',
    handleBoxShadowHover: '0 0 0 1px #383838',
    handleBoxShadowActive: '0 0 0 1px #383838',
    handleBoxShadowFocus: '0 0 0 1px #383838',
  },
  Select: {
    peers: {
      InternalSelection: {
        color: '#0b0b0b',
        colorActive: '#0b0b0b',
        textColor: '#4b4b4b',
        arrowColor: '#4b4b4b',
        border: '1px solid #202020',
        borderHover: '1px solid #2b2b2b',
        peers: {
          Popover: {
            color: '#080808',
            textColor: '#4b4b4b',
            dividerColor: '#181818',
          },
        },
      },
      InternalSelectMenu: {
        color: '#080808',
        optionTextColor: '#4b4b4b',
        optionTextColorPressed: '#555555',
        optionTextColorActive: '#427f6c',
        optionColorPending: '#101010',
        optionColorActive: '#0d1512',
        optionColorActivePending: '#111c18',
      },
    },
  },
};

const readerNaiveThemeOverrides = computed<GlobalThemeOverrides | undefined>(
  () => {
    if (activeSettings.value.theme === 'sepia') {
      return sepiaNaiveThemeOverrides;
    }
    if (activeSettings.value.theme === 'ultra-dark') {
      return ultraDarkNaiveThemeOverrides;
    }
    return undefined;
  },
);

const toggleQuickTheme = () => {
  settings.value.theme = isDarkReaderTheme.value ? 'light' : 'dark';
};

const updateAutoTranslationPreloadPages = (value: number | null) => {
  settings.value.autoTranslationPreloadParagraphs =
    normalizeReaderAutoTranslationPreloadParagraphs(value);
};

const readerStyle = computed(() => ({
  '--reader-font-size': `${activeSettings.value.fontSize}px`,
  '--reader-line-height': activeSettings.value.lineHeight,
  '--reader-content-width': `${activeSettings.value.contentWidth}px`,
  '--reader-padding': `${activeSettings.value.horizontalPadding}px`,
}));

const loadSettings = async () => {
  try {
    const repository = await repositoryPromise;
    settings.value = normalizeReaderSettings(
      await repository.getReaderSettings(),
    );
  } catch {
    message.warning('无法读取阅读设置，已使用默认值');
  } finally {
    settingsLoaded = true;
  }
};

const load = async () => {
  const requestId = ++loadUiRequestId;
  pendingScrolledContentEdge = undefined;
  const targetBookId = bookId.value;
  const targetChapterId = requestedChapterId.value;
  await recordReadingTime();
  if (requestId !== loadUiRequestId) return;
  const chapterEdge = pendingChapterEdge;
  const preservesScrolledContent =
    chapterEdge !== undefined &&
    resolvedFlow.value === 'scrolled' &&
    result.value?.kind === 'ready';
  showMobileTranslationNotice.value = false;
  if (!preservesScrolledContent) {
    initialSegmentId.value = undefined;
    loading.value = true;
  }
  const controller = await controllerPromise;
  if (requestId !== loadUiRequestId) return;
  const loaded = await controller.load(targetBookId, targetChapterId);
  if (requestId !== loadUiRequestId || loaded.kind === 'stale') return;
  if (loaded.kind === 'ready') {
    loaded.chapter = withTemporaryTranslations(loaded.chapter);
  }
  if (loaded.kind === 'ready' && targetChapterId !== loaded.chapter.chapterId) {
    void router.replace(
      `/books/${encodeURIComponent(targetBookId)}/read/${encodeURIComponent(loaded.chapter.chapterId)}`,
    );
  }
  if (
    loaded.kind === 'ready' &&
    chapterEdge !== undefined &&
    preservesScrolledContent
  ) {
    await Promise.all([resolveMode(loaded), loadBookmarks(loaded.book.id)]);
    enableTemporaryReadingModes(loaded.chapter);
    if (requestId !== loadUiRequestId) return;
    const targetSegment =
      chapterEdge === 'end'
        ? loaded.chapter.segments.at(-1)
        : loaded.chapter.segments[0];
    if (loaded.chapter.epub !== undefined) {
      pendingScrolledContentEdge = {
        chapterId: loaded.chapter.chapterId,
        edge: chapterEdge,
      };
    }
    initialSegmentId.value = targetSegment?.id;
    await initializeContinuousChapters(loaded.chapter, loaded.chapters);
    if (requestId !== loadUiRequestId) return;
    result.value = loaded;
    pendingChapterEdge = undefined;
    loading.value = false;
    await scrollToChapterEdge(chapterEdge);
    updateViewportMetrics();
    startReadingTime(loaded.book.id);
    return;
  }
  if (loaded.kind === 'ready') {
    await Promise.all([resolveMode(loaded), loadBookmarks(loaded.book.id)]);
    enableTemporaryReadingModes(loaded.chapter);
    if (requestId !== loadUiRequestId) return;
    await initializeContinuousChapters(loaded.chapter, loaded.chapters);
    if (requestId !== loadUiRequestId) return;
    result.value = loaded;
    loading.value = false;
    if (resolvedFlow.value === 'scrolled') {
      await scrollToChapterEdge('start');
    }
    await restoreProgress(loaded);
    if (requestId !== loadUiRequestId) return;
    await restorePendingBookmark(loaded);
    if (requestId !== loadUiRequestId) return;
    pendingChapterEdge = undefined;
    if (chapterEdge !== undefined) {
      const targetSegment =
        chapterEdge === 'end'
          ? loaded.chapter.segments.at(-1)
          : loaded.chapter.segments[0];
      if (loaded.chapter.epub !== undefined) {
        pendingScrolledContentEdge = {
          chapterId: loaded.chapter.chapterId,
          edge: chapterEdge,
        };
      }
      initialSegmentId.value = targetSegment?.id;
      await scrollToChapterEdge(chapterEdge);
    } else if (requestedSegmentId.value !== undefined) {
      await nextTick();
      scrollToSegment(requestedSegmentId.value);
    }
    await nextTick();
    updateViewportMetrics();
    startReadingTime(loaded.book.id);
    return;
  }
  scrolledPreviewGeneration += 1;
  previousChapterPreviews.value = [];
  nextChapterPreviews.value = [];
  continuousChapters.value = [];
  result.value = loaded;
  loading.value = false;
};

const resolveMode = async (
  loaded: Extract<ReaderPageLoadResult, { kind: 'ready' }>,
) => {
  const [repository, adapter] = await Promise.all([
    repositoryPromise,
    cachedAdapterPromise,
  ]);
  const [preference, capabilities] = await Promise.all([
    repository.getReaderBookPreference(loaded.book.id),
    adapter.getCapabilities(loaded.book.id),
  ]);
  if (!loaded.book.requiresWholeChapterTranslation) {
    availableModes.value = ['original'];
    readingMode.value = 'original';
    bookStyle.value = preference?.style;
    return;
  }
  availableModes.value = getAvailableReaderModes();
  readingMode.value = resolveReaderMode({
    temporaryMode,
    preference,
    settings: normalizeReaderSettings(await repository.getReaderSettings()),
    capabilities,
  });
  bookStyle.value = preference?.style;
};

const chooseMode = async (mode: ReaderMode) => {
  const anchor = captureReaderPosition();
  temporaryMode = mode;
  readingMode.value = mode;
  await nextTick();
  await nextTick();
  restoreReaderPosition(anchor);
  updateViewportMetrics();
  scheduleCurrentContinuousPreviewFill();
  await saveProgress();
};

const chooseSettingsMode = async (mode: ReaderMode) => {
  await chooseMode(mode);
  const repository = await repositoryPromise;
  const preference = await repository.getReaderBookPreference(bookId.value);
  await repository.putReaderBookPreference({
    ...preference,
    bookId: bookId.value,
    preferredMode: mode,
    updatedAt: Date.now(),
  });
};

const getSegmentElements = (root: ParentNode = document) => {
  const elements = [
    ...root.querySelectorAll<HTMLElement>('[data-reader-segment-id]'),
  ];
  root
    .querySelectorAll<HTMLElement>('[data-reader-epub-host]')
    .forEach((host) => {
      if (host.shadowRoot !== null) {
        elements.push(
          ...host.shadowRoot.querySelectorAll<HTMLElement>(
            '[data-reader-segment-id]',
          ),
        );
      }
    });
  return elements;
};

type ReaderPositionAnchor = {
  chapterId: string;
  segmentId: string;
  sourceLine?: number;
  languageSide?: 'original' | 'translated';
  offsetRatio: number;
  viewportTopOffset: number;
};

type ReaderCharacterPosition = {
  offset: number;
  rect: DOMRect;
};

const getReaderVisibleTop = () =>
  controlsVisible.value
    ? (document
        .querySelector<HTMLElement>('.book-reader__app-bar')
        ?.getBoundingClientRect().bottom ?? 0)
    : 0;

const getReaderVisibleBottom = () =>
  controlsVisible.value
    ? (document
        .querySelector<HTMLElement>('.book-reader__bottom-navigation')
        ?.getBoundingClientRect().top ?? window.innerHeight)
    : window.innerHeight;

const getParagraphCharacterPositions = (paragraph: HTMLElement) => {
  const positions: ReaderCharacterPosition[] = [];
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let paragraphOffset = 0;
  while (node !== null) {
    const text = node.textContent ?? '';
    for (let offset = 0; offset < text.length; offset += 1) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = [...range.getClientRects()].find(
        (item) => item.width > 0 && item.height > 0,
      );
      if (rect !== undefined) {
        positions.push({ offset: paragraphOffset + offset, rect });
      }
    }
    paragraphOffset += text.length;
    node = walker.nextNode();
  }
  return positions;
};

const getSegmentLanguageElements = (segment: HTMLElement) => [
  ...(segment.matches('[data-reader-language-side]') ? [segment] : []),
  ...segment.querySelectorAll<HTMLElement>('[data-reader-language-side]'),
];

const getSegmentSourceLine = (chapterId: string, segmentId: string) => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return undefined;
  const chapter = [ready.chapter, ...continuousChapters.value].find(
    (item) => item.chapterId === chapterId,
  );
  return chapter?.segments.find((segment) => segment.id === segmentId)
    ?.sourceLine;
};

function rememberScrolledLayoutAnchor() {
  if (resolvedFlow.value !== 'scrolled') return;
  const chapter = getActiveContinuousChapterElement();
  const chapterId = chapter?.dataset.readerChapterId;
  const segmentId = viewportSegmentId.value;
  const segment =
    chapter === undefined || segmentId === undefined
      ? undefined
      : getSegmentElements(chapter).find(
          (item) => item.dataset.readerSegmentId === segmentId,
        );
  if (
    chapterId === undefined ||
    segmentId === undefined ||
    segment === undefined
  )
    return;
  lastScrolledLayoutAnchor = {
    chapterId,
    segmentId,
    viewportTopOffset:
      segment.getBoundingClientRect().top - getReaderVisibleTop(),
  };
}

function restoreScrolledLayoutAnchor(anchor: typeof lastScrolledLayoutAnchor) {
  if (anchor === undefined || resolvedFlow.value !== 'scrolled') return;
  const chapter = getContinuousChapterElement(anchor.chapterId);
  const segment =
    chapter === undefined
      ? undefined
      : getSegmentElements(chapter).find(
          (item) => item.dataset.readerSegmentId === anchor.segmentId,
        );
  if (segment === undefined) return;
  window.scrollBy({
    top:
      segment.getBoundingClientRect().top -
      (getReaderVisibleTop() + anchor.viewportTopOffset),
    behavior: 'auto',
  });
}

const captureReaderPosition = (): ReaderPositionAnchor | undefined => {
  const viewport = readerViewport.value;
  const paginated = resolvedFlow.value === 'paginated' && viewport !== null;
  const bounds = paginated
    ? viewport.getBoundingClientRect()
    : {
        top: getReaderVisibleTop(),
        right: window.innerWidth,
        bottom: getReaderVisibleBottom(),
        left: 0,
      };
  const intersectsViewport = (rect: DOMRect) =>
    rect.right > bounds.left + 1 &&
    rect.left < bounds.right - 1 &&
    rect.bottom > bounds.top + 1 &&
    rect.top < bounds.bottom - 1;
  const segmentRoot =
    resolvedFlow.value === 'scrolled'
      ? getActiveContinuousChapterElement()
      : undefined;
  const candidates = getSegmentElements(segmentRoot ?? document).flatMap(
    (segment) =>
      getSegmentLanguageElements(segment)
        .filter((paragraph) =>
          [...paragraph.getClientRects()].some(intersectsViewport),
        )
        .flatMap((paragraph) =>
          getParagraphCharacterPositions(paragraph).map((position) => ({
            ...position,
            paragraph,
            segment,
          })),
        ),
  );
  const visible = candidates.filter(({ rect }) =>
    paginated
      ? rect.right > bounds.left + 1 &&
        rect.left < bounds.right - 1 &&
        rect.bottom > bounds.top + 1 &&
        rect.top < bounds.bottom - 1
      : rect.top >= bounds.top - 1 &&
        rect.bottom <= bounds.bottom + 1 &&
        rect.left >= bounds.left - 1 &&
        rect.right <= bounds.right + 1,
  );
  visible.sort((left, right) => {
    if (paginated && Math.abs(left.rect.left - right.rect.left) > 2) {
      return left.rect.left - right.rect.left;
    }
    if (Math.abs(left.rect.top - right.rect.top) > 2) {
      return left.rect.top - right.rect.top;
    }
    return left.rect.left - right.rect.left;
  });
  const atScrolledChapterStart =
    resolvedFlow.value === 'scrolled' &&
    (getActiveContinuousChapterElement()?.getBoundingClientRect().top ?? -2) >=
      -1;
  const first = atScrolledChapterStart
    ? candidates[0]
    : (visible[0] ?? candidates[0]);
  const segmentId = first?.segment.dataset.readerSegmentId;
  if (first === undefined || segmentId === undefined) return undefined;
  const chapterId =
    first.segment.closest<HTMLElement>('[data-reader-chapter-id]')?.dataset
      .readerChapterId ??
    (result.value?.kind === 'ready'
      ? result.value.chapter.chapterId
      : undefined);
  if (chapterId === undefined) return undefined;
  const textLength = first.paragraph.textContent?.length ?? 0;
  const languageSide = first.paragraph.dataset.readerLanguageSide;
  return {
    chapterId,
    segmentId,
    sourceLine: getSegmentSourceLine(chapterId, segmentId),
    languageSide:
      languageSide === 'original' || languageSide === 'translated'
        ? languageSide
        : undefined,
    offsetRatio: textLength <= 1 ? 0 : first.offset / (textLength - 1),
    viewportTopOffset: first.rect.top - bounds.top,
  };
};

const restoreReaderPosition = (anchor: ReaderPositionAnchor | undefined) => {
  if (anchor === undefined) return;
  const segmentRoot =
    resolvedFlow.value === 'scrolled'
      ? getContinuousChapterElement(anchor.chapterId)
      : undefined;
  const matchingSegments = getSegmentElements(segmentRoot ?? document).filter(
    (item) => item.dataset.readerSegmentId === anchor.segmentId,
  );
  const segment =
    matchingSegments.find(
      (item) => item.dataset.readerLanguageSide === anchor.languageSide,
    ) ?? matchingSegments[0];
  if (segment === undefined) {
    scrollToSegment(anchor.segmentId);
    return;
  }
  const paragraphs = getSegmentLanguageElements(segment);
  const paragraph =
    paragraphs.find(
      (item) => item.dataset.readerLanguageSide === anchor.languageSide,
    ) ?? paragraphs[0];
  if (paragraph === undefined) {
    scrollToSegment(anchor.segmentId);
    return;
  }
  const positions = getParagraphCharacterPositions(paragraph);
  if (positions.length === 0) {
    scrollToSegment(anchor.segmentId);
    return;
  }
  const textLength = paragraph.textContent?.length ?? 0;
  const targetOffset = Math.round(
    anchor.offsetRatio * Math.max(0, textLength - 1),
  );
  const target = positions.reduce((closest, position) =>
    Math.abs(position.offset - targetOffset) <
    Math.abs(closest.offset - targetOffset)
      ? position
      : closest,
  );
  if (resolvedFlow.value === 'paginated' && readerViewport.value !== null) {
    const viewport = readerViewport.value;
    const viewportRect = viewport.getBoundingClientRect();
    const absoluteLeft =
      viewport.scrollLeft + target.rect.left - viewportRect.left;
    positionReaderPage(
      viewport,
      Math.max(
        0,
        Math.floor((absoluteLeft + 1) / Math.max(1, viewport.clientWidth)),
      ),
    );
    paginatedAnchorSegmentId = anchor.segmentId;
    return;
  }
  window.scrollBy({
    top: target.rect.top - (getReaderVisibleTop() + anchor.viewportTopOffset),
    behavior: 'auto',
  });
};

const getActiveSegmentId = (flow = resolvedFlow.value) => {
  const elements =
    flow === 'scrolled'
      ? (() => {
          const chapter = getActiveContinuousChapterElement();
          return chapter === undefined ? [] : getSegmentElements(chapter);
        })()
      : getSegmentElements();
  if (flow === 'paginated' && readerViewport.value !== null) {
    const viewportRect = readerViewport.value.getBoundingClientRect();
    return (
      elements.find((element) => {
        return [...element.getClientRects()].some(
          (rect) =>
            rect.right > viewportRect.left + 4 &&
            rect.left < viewportRect.right - 4 &&
            rect.bottom > viewportRect.top + 4 &&
            rect.top < viewportRect.bottom - 4,
        );
      })?.dataset.readerSegmentId ?? elements[0]?.dataset.readerSegmentId
    );
  }
  return (
    [...elements]
      .reverse()
      .find((element) => element.getBoundingClientRect().top <= 120)?.dataset
      .readerSegmentId ?? elements[0]?.dataset.readerSegmentId
  );
};

const getSegmentPageIndex = (
  viewport: HTMLElement,
  segmentId: string | undefined,
) => {
  if (segmentId === undefined) return undefined;
  const element = getSegmentElements().find(
    (item) => item.dataset.readerSegmentId === segmentId,
  );
  const rect = element?.getClientRects()[0];
  if (rect === undefined) return undefined;
  const viewportRect = viewport.getBoundingClientRect();
  const absoluteLeft = viewport.scrollLeft + rect.left - viewportRect.left;
  return Math.max(
    0,
    Math.floor((absoluteLeft + 1) / Math.max(1, viewport.clientWidth)),
  );
};

const scrollToSegment = (segmentId: string | undefined) => {
  if (segmentId === undefined) {
    if (resolvedFlow.value === 'paginated') {
      paginatedAnchorSegmentId = undefined;
      if (readerViewport.value !== null) {
        positionReaderPage(readerViewport.value, 0);
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    return;
  }
  const scroll = () => {
    const element = getSegmentElements().find(
      (item) => item.dataset.readerSegmentId === segmentId,
    );
    if (element === undefined) return;
    if (resolvedFlow.value === 'paginated') {
      paginatedAnchorSegmentId = segmentId;
      const viewport = readerViewport.value;
      if (viewport === null) return;
      const pageIndex = getSegmentPageIndex(viewport, segmentId);
      if (pageIndex === undefined) return;
      positionReaderPage(viewport, pageIndex);
      return;
    }
    element.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: 'auto',
    });
  };
  if (
    getSegmentElements().some(
      (element) => element.dataset.readerSegmentId === segmentId,
    )
  ) {
    scroll();
    return;
  }
  if (resolvedFlow.value === 'scrolled') {
    const chapter = continuousChapters.value.find((item) =>
      item.segments.some((segment) => segment.id === segmentId),
    );
    if (chapter !== undefined) {
      continuousChapterInitialSegments.set(chapter.chapterId, segmentId);
      continuousChapters.value = [...continuousChapters.value];
    }
  }
  initialSegmentId.value = segmentId;
  void nextTick().then(scroll);
};

const decodeEpubFragment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeEpubHrefKey = (href: string) => {
  const separator = href.indexOf('#');
  return separator < 0
    ? href
    : `${href.slice(0, separator)}#${decodeEpubFragment(href.slice(separator + 1))}`;
};

const findEpubTargetElement = (href: string) => {
  const separator = href.indexOf('#');
  if (separator < 0) return undefined;
  const fragment = decodeEpubFragment(href.slice(separator + 1));
  for (const host of document.querySelectorAll<HTMLElement>(
    '[data-reader-epub-host]',
  )) {
    const target = Array.from(
      host.shadowRoot?.querySelectorAll<HTMLElement>('[id], a[name]') ?? [],
    ).find(
      (element) =>
        element.id === fragment || element.getAttribute('name') === fragment,
    );
    if (target !== undefined) return target;
  }
  return undefined;
};

const scrollToEpubHref = (href: string) => {
  const target = findEpubTargetElement(href);
  if (target !== undefined) {
    if (resolvedFlow.value === 'paginated' && readerViewport.value !== null) {
      const viewport = readerViewport.value;
      const rect = target.getClientRects()[0];
      if (rect === undefined) return false;
      const viewportRect = viewport.getBoundingClientRect();
      const absoluteLeft = viewport.scrollLeft + rect.left - viewportRect.left;
      positionReaderPage(
        viewport,
        Math.max(
          0,
          Math.floor((absoluteLeft + 1) / Math.max(1, viewport.clientWidth)),
        ),
      );
    } else {
      target.scrollIntoView({
        block: 'start',
        inline: 'nearest',
        behavior: 'auto',
      });
    }
    return true;
  }
  if (result.value?.kind !== 'ready') return false;
  const key = normalizeEpubHrefKey(href);
  const linkTarget = result.value.chapter.epub?.linkTargets.find(
    (item) => normalizeEpubHrefKey(item.href) === key,
  );
  if (linkTarget?.segmentId === undefined) return false;
  scrollToSegment(linkTarget.segmentId);
  return true;
};

const scrollToChapterEdge = async (edge: 'start' | 'end') => {
  await nextTick();
  await nextTick();
  if (resolvedFlow.value === 'scrolled') {
    scrolledPreviewInputDirection = undefined;
    for (let frame = 0; frame < 3; frame += 1) {
      const currentChapter =
        result.value?.kind === 'ready'
          ? getContinuousChapterElement(result.value.chapter.chapterId)
          : undefined;
      const rect = currentChapter?.getBoundingClientRect();
      window.scrollTo({
        top:
          edge === 'start'
            ? window.scrollY + (rect?.top ?? 0) - getReaderVisibleTop()
            : window.scrollY +
              (rect?.bottom ?? window.innerHeight) -
              getReaderVisibleBottom(),
        behavior: 'auto',
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    return;
  }
  if (resolvedFlow.value === 'paginated') {
    const viewport = readerViewport.value;
    if (viewport === null) return;
    viewport.style.setProperty('--reader-page-tail-space', '0px');
    resetPaginatedVerticalPosition(viewport);
    void viewport.scrollWidth;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const metrics = getReaderPageMetrics(viewport);
    positionReaderPage(viewport, edge === 'start' ? 0 : metrics.pageCount - 1);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    resetPaginatedVerticalPosition(viewport);
    paginatedAnchorSegmentId = getActiveSegmentId('paginated');
    return;
  }
};

const handleSegmentContentChange = async (anchorId?: string) => {
  await nextTick();
  const pendingEdge = pendingScrolledContentEdge;
  if (
    pendingEdge !== undefined &&
    resolvedFlow.value === 'scrolled' &&
    result.value?.kind === 'ready' &&
    result.value.chapter.chapterId === pendingEdge.chapterId
  ) {
    pendingScrolledContentEdge = undefined;
    await scrollToChapterEdge(pendingEdge.edge);
    updateViewportMetrics();
    scheduleCurrentContinuousPreviewFill();
    return;
  }
  if (
    requestedEpubHref.value !== undefined &&
    scrollToEpubHref(requestedEpubHref.value)
  ) {
    updateViewportMetrics();
    scheduleCurrentContinuousPreviewFill();
    return;
  }
  if (anchorId !== undefined && resolvedFlow.value !== 'paginated') {
    scrollToSegment(anchorId);
  }
  updateViewportMetrics();
  scheduleCurrentContinuousPreviewFill();
};

const handleChineseScriptError = () => {
  if (chineseScriptErrorShown) return;
  chineseScriptErrorShown = true;
  message.error('中文字形转换加载失败，已保留原始字形');
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

const toggleCurrentSegmentSpeech = () => {
  if (isSpeaking.value) {
    getSpeechController().stop();
    isSpeaking.value = false;
    return;
  }
  if (result.value?.kind !== 'ready') {
    return;
  }
  const segmentId = getActiveSegmentId();
  const segmentElement = getSegmentElements().find(
    (element) => element.dataset.readerSegmentId === segmentId,
  );
  const preferredSide =
    renderedMode.value === 'original' ? 'original' : 'translated';
  const languageElement =
    segmentElement === undefined
      ? undefined
      : getSegmentLanguageElements(segmentElement).find(
          (element) => element.dataset.readerLanguageSide === preferredSide,
        );
  const text = languageElement?.textContent;
  const spoken = getSpeechController().speak(
    text ?? '',
    preferredSide === 'translated' || chineseScriptSides.value.original
      ? 'zh-CN'
      : 'ja-JP',
    {
      onEnd: () => (isSpeaking.value = false),
      onError: () => (isSpeaking.value = false),
    },
  );
  if (!spoken) {
    message.warning('当前浏览器不支持朗读，或没有可朗读的段落');
    return;
  }
  isSpeaking.value = true;
};

const stopSpeaking = () => {
  getSpeechController().stop();
  isSpeaking.value = false;
};

const openInteractiveTranslation = () => {
  const shouldOpen = !showInteractiveTranslation.value;
  const text =
    window.getSelection()?.toString().trim() ||
    pendingInteractiveSelection ||
    selectedReaderText.value;
  pendingInteractiveSelection = '';
  selectedReaderText.value = '';
  closeReaderPanels();
  if (!shouldOpen) return;
  interactiveInitialText.value = text || undefined;
  showInteractiveTranslation.value = true;
};

type VisibleReaderSegment = {
  chapterId: string;
  segmentId: string;
  original: string;
};

const renderedReaderChapters = () => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return [];
  return [
    ...new Map(
      [
        ready.chapter,
        ...continuousChapters.value,
        ...previousChapterPreviews.value.map(({ chapter }) => chapter),
        ...nextChapterPreviews.value.map(({ chapter }) => chapter),
      ].map((chapter) => [chapter.chapterId, chapter]),
    ).values(),
  ];
};

const getVisibleReaderSegments = (): VisibleReaderSegment[] => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return [];
  const viewport = readerViewport.value;
  const bounds =
    resolvedFlow.value === 'paginated' && viewport !== null
      ? viewport.getBoundingClientRect()
      : {
          top: getReaderVisibleTop(),
          right: window.innerWidth,
          bottom: getReaderVisibleBottom(),
          left: 0,
        };
  const chapters = new Map(
    renderedReaderChapters().map((chapter) => [chapter.chapterId, chapter]),
  );
  const seen = new Set<string>();
  return getSegmentElements().flatMap((element) => {
    if (
      ![...element.getClientRects()].some(
        (rect) =>
          rect.right > bounds.left + 1 &&
          rect.left < bounds.right - 1 &&
          rect.bottom > bounds.top + 1 &&
          rect.top < bounds.bottom - 1,
      )
    ) {
      return [];
    }
    const root = element.getRootNode();
    const chapterContainer = element.closest<HTMLElement>(
      '[data-reader-chapter-id], [data-reader-preview-chapter-id]',
    );
    const shadowChapterContainer =
      root instanceof ShadowRoot
        ? root.host.closest<HTMLElement>(
            '[data-reader-chapter-id], [data-reader-preview-chapter-id]',
          )
        : undefined;
    const chapterId =
      chapterContainer?.dataset.readerChapterId ??
      chapterContainer?.dataset.readerPreviewChapterId ??
      shadowChapterContainer?.dataset.readerChapterId ??
      shadowChapterContainer?.dataset.readerPreviewChapterId ??
      ready.chapter.chapterId;
    const segmentId = element.dataset.readerSegmentId;
    const key =
      segmentId === undefined
        ? undefined
        : temporaryTranslationKey(chapterId, segmentId);
    if (segmentId === undefined || key === undefined || seen.has(key))
      return [];
    const segment = chapters
      .get(chapterId)
      ?.segments.find((item) => item.id === segmentId);
    if (segment === undefined || segment.original.trim().length === 0)
      return [];
    seen.add(key);
    return [{ chapterId, segmentId, original: segment.original }];
  });
};

const createVisibleTranslationConfig = (
  type: 'gpt' | 'sakura',
  worker: GptWorker | SakuraWorker,
): TranslatorConfig =>
  type === 'gpt'
    ? {
        id: 'gpt',
        model: (worker as GptWorker).model,
        endpoint: worker.endpoint,
        key: (worker as GptWorker).key,
      }
    : {
        id: 'sakura',
        endpoint: worker.endpoint,
        segLength: (worker as SakuraWorker).segLength,
        prevSegLength: (worker as SakuraWorker).prevSegLength,
      };

type ActiveAutomaticTranslationRuntime = {
  selection: ReaderAutomaticTranslationSelection;
  config: TranslatorConfig;
  concurrency: number;
  glossary: Record<string, string>;
  targetChapterId?: string;
  retranslation?: ReaderRetranslationOptions;
};

let activeAutomaticTranslationRuntime:
  ActiveAutomaticTranslationRuntime | undefined;
let automaticTranslationStartRequest = 0;

const loadedReaderChapters = () => {
  return renderedReaderChapters().sort(
    (left, right) => left.chapterIndex - right.chapterIndex,
  );
};

const renderTemporaryTranslations = async (changedChapterIds: Set<string>) => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return;
  const loadedIds = new Set(
    loadedReaderChapters().map(({ chapterId }) => chapterId),
  );
  if (![...changedChapterIds].some((chapterId) => loadedIds.has(chapterId))) {
    return;
  }
  const anchor = captureReaderPosition();
  continuousChapters.value = continuousChapters.value.map(
    withTemporaryTranslations,
  );
  previousChapterPreviews.value = previousChapterPreviews.value.map(
    (preview) => ({
      ...preview,
      chapter: withTemporaryTranslations(preview.chapter),
    }),
  );
  nextChapterPreviews.value = nextChapterPreviews.value.map((preview) => ({
    ...preview,
    chapter: withTemporaryTranslations(preview.chapter),
  }));
  const chapter =
    continuousChapters.value.find(
      ({ chapterId }) => chapterId === ready.chapter.chapterId,
    ) ?? withTemporaryTranslations(ready.chapter);
  result.value = { ...ready, chapter };
  enableTemporaryReadingModes(chapter);
  await nextTick();
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  restoreReaderPosition(anchor);
  updateViewportMetrics();
};

const showAutomaticTranslationDraft = (
  selection: ReaderAutomaticTranslationSelection,
  values: Array<{ chapterId: string; segmentId: string; translated: string }>,
) => {
  if (!automaticTranslationSession.isActive(selection)) return;
  const changedChapterIds = new Set<string>();
  values.forEach(({ chapterId, segmentId, translated }) => {
    temporaryTranslations.set(
      temporaryTranslationKey(chapterId, segmentId),
      translated,
    );
    changedChapterIds.add(chapterId);
  });
  void renderTemporaryTranslations(changedChapterIds);
};

const discardAutomaticTranslationChapterDraft = async (
  selection: ReaderAutomaticTranslationSelection,
  chapterId: string,
) => {
  const targetBookId = bookId.value;
  automaticTranslationSession.clearChapter(selection, chapterId);
  const prefix = `${chapterId}\u0000`;
  [...temporaryTranslations.keys()]
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => temporaryTranslations.delete(key));
  const repository = await repositoryPromise;
  await repository.deleteReaderAutomaticTranslationCaches({
    bookId: targetBookId,
    chapterId,
  });
  const ready = result.value;
  if (
    ready?.kind !== 'ready' ||
    ready.book.id !== targetBookId ||
    !loadedReaderChapters().some((chapter) => chapter.chapterId === chapterId)
  ) {
    return;
  }
  const anchoredChapterId = ready.chapter.chapterId;
  const anchor = captureReaderPosition();
  const adapter = await cachedAdapterPromise;
  adapter.invalidateChapter({ bookId: targetBookId, chapterId });
  const [chapter, chapters] = await Promise.all([
    adapter.getChapter({ bookId: targetBookId, chapterId }),
    adapter.getChapters(targetBookId),
  ]);
  if (result.value?.kind !== 'ready' || result.value.book.id !== targetBookId) {
    return;
  }
  const latest = result.value;
  continuousChapters.value = continuousChapters.value.map((loaded) =>
    loaded.chapterId === chapterId ? chapter : loaded,
  );
  result.value = {
    ...latest,
    chapters,
    chapter: latest.chapter.chapterId === chapterId ? chapter : latest.chapter,
  };
  await nextTick();
  await nextTick();
  if (result.value?.chapter.chapterId === anchoredChapterId) {
    restoreReaderPosition(anchor);
  }
  updateViewportMetrics();
};

const markAutomaticTranslationCommitted = async (
  selection: ReaderAutomaticTranslationSelection,
  chapterId: string,
) => {
  if (!automaticTranslationSession.isActive(selection)) return;
  await discardAutomaticTranslationChapterDraft(selection, chapterId);
  const chapters = result.value?.kind === 'ready' ? result.value.chapters : [];
  if (
    chapters.length > 0 &&
    chapters.every(({ translationStatus }) => translationStatus === 'complete')
  ) {
    stopAutomaticTranslation(false);
    message.success('全书翻译已完成');
  } else {
    scheduleAutomaticTranslation();
  }
};

const adoptCompletedChapterTranslation = async (chapterId: string) => {
  const targetBookId = bookId.value;
  if (
    pendingRetranslation.value?.bookId === targetBookId &&
    pendingRetranslation.value.chapterId === chapterId
  ) {
    pendingRetranslation.value = undefined;
    showRetranslationDecision.value = false;
  }
  const selection = activeAutomaticTranslationRuntime?.selection;
  if (
    selection !== undefined &&
    (selection.purpose ?? 'automatic') === 'retranslate' &&
    retranslationChapterId.value === chapterId
  ) {
    haltAutomaticTranslationRuntime();
  }
  if (selection !== undefined) {
    await discardAutomaticTranslationChapterDraft(selection, chapterId);
    if ((selection.purpose ?? 'automatic') === 'automatic') {
      scheduleAutomaticTranslation();
    }
    return;
  }
  const prefix = `${chapterId}\u0000`;
  [...temporaryTranslations.keys()]
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => temporaryTranslations.delete(key));
  const repository = await repositoryPromise;
  await repository.deleteReaderAutomaticTranslationCaches({
    bookId: targetBookId,
    chapterId,
  });
  const ready = result.value;
  if (ready?.kind !== 'ready' || ready.book.id !== targetBookId) return;
  const anchoredChapterId = ready.chapter.chapterId;
  const anchor = captureReaderPosition();
  const adapter = await cachedAdapterPromise;
  adapter.invalidateChapter({ bookId: targetBookId, chapterId });
  const [chapter, chapters] = await Promise.all([
    adapter.getChapter({ bookId: targetBookId, chapterId }),
    adapter.getChapters(targetBookId),
  ]);
  if (result.value?.kind !== 'ready' || result.value.book.id !== targetBookId) {
    return;
  }
  const latest = result.value;
  continuousChapters.value = continuousChapters.value.map((loaded) =>
    loaded.chapterId === chapterId ? chapter : loaded,
  );
  result.value = {
    ...latest,
    chapters,
    chapter: latest.chapter.chapterId === chapterId ? chapter : latest.chapter,
  };
  await nextTick();
  await nextTick();
  if (result.value?.chapter.chapterId === anchoredChapterId) {
    restoreReaderPosition(anchor);
  }
  updateViewportMetrics();
};

const collectAutomaticTranslationChapters = async (
  visible: VisibleReaderSegment[],
) => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return [];
  const completedChapterIds = new Set(
    ready.chapters
      .filter(({ translationStatus }) => translationStatus === 'complete')
      .map(({ id }) => id),
  );
  const visibleChapterIds = new Set(visible.map(({ chapterId }) => chapterId));
  const chapters = new Map(
    loadedReaderChapters()
      .filter(
        (chapter) =>
          visibleChapterIds.has(chapter.chapterId) ||
          !completedChapterIds.has(chapter.chapterId),
      )
      .map((chapter) => [chapter.chapterId, chapter]),
  );
  const visibleIndexes = visible.flatMap(({ chapterId }) => {
    const index = ready.chapters.findIndex(({ id }) => id === chapterId);
    return index < 0 ? [] : [index];
  });
  if (visibleIndexes.length === 0) return [...chapters.values()];
  const continuationSummary = ready.chapters
    .slice(Math.min(...visibleIndexes))
    .find(({ translationStatus }) => translationStatus !== 'complete');
  if (
    continuationSummary !== undefined &&
    !chapters.has(continuationSummary.id)
  ) {
    const chapter = await (
      await cachedAdapterPromise
    ).getChapter({
      bookId: bookId.value,
      chapterId: continuationSummary.id,
    });
    chapters.set(chapter.chapterId, chapter);
  }
  let nextIndex = Math.max(...visibleIndexes) + 1;
  const adapter = await cachedAdapterPromise;
  while (true) {
    const planned = planReaderAutomaticTranslationWindow({
      chapters: [...chapters.values()],
      visible,
      preloadParagraphs: settings.value.autoTranslationPreloadParagraphs,
    });
    if (
      planned.prefetch.length >= planned.prefetchParagraphLimit ||
      nextIndex >= ready.chapters.length
    ) {
      break;
    }
    const summary = ready.chapters[nextIndex];
    nextIndex += 1;
    if (
      summary === undefined ||
      completedChapterIds.has(summary.id) ||
      chapters.has(summary.id)
    )
      continue;
    const chapter = await adapter.getChapter({
      bookId: bookId.value,
      chapterId: summary.id,
    });
    chapters.set(chapter.chapterId, chapter);
  }
  return [...chapters.values()].sort(
    (left, right) => left.chapterIndex - right.chapterIndex,
  );
};

const runAutomaticTranslationOnce = async () => {
  const runtime = activeAutomaticTranslationRuntime;
  const controller = automaticTranslationController;
  if (
    runtime === undefined ||
    controller === undefined ||
    controller.signal.aborted ||
    !automaticTranslationSession.isActive(runtime.selection)
  ) {
    return;
  }
  const isRetranslation =
    (runtime.selection.purpose ?? 'automatic') === 'retranslate';
  const repository = await repositoryPromise;
  let planned: ReturnType<typeof planReaderAutomaticTranslationWindow>;
  if (isRetranslation) {
    const chapterId = runtime.targetChapterId;
    if (chapterId === undefined) return;
    const chapter = await repository.getChapter(bookId.value, chapterId);
    if (chapter === undefined) throw new Error('章节不存在');
    const complete = buildCompleteReaderChapterTranslation({
      chapter,
      chapterId,
      selection: runtime.selection,
      session: automaticTranslationSession,
    });
    if (complete !== undefined) {
      complete.glossary = { ...runtime.glossary };
      await handleRetranslationComplete(runtime.selection, chapterId, complete);
      return;
    }
    const targets = chapter.paragraphs.flatMap((original, segmentIndex) =>
      original.trim().length === 0
        ? []
        : [
            {
              chapterId,
              segmentId: chapter.segmentIds[segmentIndex]!,
              segmentIndex,
              original,
            },
          ],
    );
    planned = {
      current: targets,
      prefetch: [],
      all: targets,
      prefetchParagraphLimit: 0,
    };
  } else {
    const ready = result.value;
    if (ready?.kind !== 'ready') return;
    const visible = getVisibleReaderSegments();
    if (visible.length === 0) return;
    const chapters = await collectAutomaticTranslationChapters(visible);
    if (controller.signal.aborted) return;
    planned = planReaderAutomaticTranslationWindow({
      chapters,
      visible,
      preloadParagraphs: settings.value.autoTranslationPreloadParagraphs,
    });
    const visibleChapterIndexes = visible.flatMap(({ chapterId }) => {
      const index = ready.chapters.findIndex(({ id }) => id === chapterId);
      return index < 0 ? [] : [index];
    });
    const continuationSummary = ready.chapters
      .slice(
        visibleChapterIndexes.length === 0
          ? 0
          : Math.min(...visibleChapterIndexes),
      )
      .find(({ translationStatus }) => translationStatus !== 'complete');
    const continuationChapter = chapters.find(
      ({ chapterId }) => chapterId === continuationSummary?.id,
    );
    const plannedHasUntranslatedTarget = planned.all.some((target) => {
      const segment = chapters
        .find(({ chapterId }) => chapterId === target.chapterId)
        ?.segments.find(({ id }) => id === target.segmentId);
      return (
        (segment?.translated?.trim().length ?? 0) === 0 &&
        automaticTranslationSession.get(
          runtime.selection,
          target.chapterId,
          target.segmentId,
        ) === undefined
      );
    });
    if (continuationChapter !== undefined && !plannedHasUntranslatedTarget) {
      const plannedKeys = new Set(
        planned.all.map(({ chapterId, segmentId }) =>
          temporaryTranslationKey(chapterId, segmentId),
        ),
      );
      const continuationTargets: typeof planned.all = [];
      const continuationParagraphLimit = Math.max(
        1,
        planned.current.length,
        planned.prefetchParagraphLimit,
      );
      for (const segment of continuationChapter.segments) {
        const key = temporaryTranslationKey(
          continuationChapter.chapterId,
          segment.id,
        );
        const sourceLength = segment.original.trim().length;
        if (
          sourceLength === 0 ||
          plannedKeys.has(key) ||
          automaticTranslationSession.get(
            runtime.selection,
            continuationChapter.chapterId,
            segment.id,
          ) !== undefined
        ) {
          continue;
        }
        continuationTargets.push({
          chapterId: continuationChapter.chapterId,
          segmentId: segment.id,
          segmentIndex: segment.index,
          original: segment.original,
        });
        if (continuationTargets.length >= continuationParagraphLimit) break;
      }
      planned = {
        ...planned,
        all: [...planned.all, ...continuationTargets],
      };
    }
  }
  if (planned.all.length === 0) return;
  const coordinator = new ReaderAutomaticTranslationCoordinator(
    automaticTranslationSession,
    {
      loadChapter: (chapterId) =>
        repository.getChapter(bookId.value, chapterId),
      translate: async (
        selection,
        originals,
        glossary,
        signal,
        onTranslated,
      ) => {
        if (!automaticTranslationSession.isActive(selection)) return [];
        const translator = await Translator.create(runtime.config, false);
        return translator.translate(
          originals,
          { force: true, glossary, signal },
          {
            concurrency: 1,
            onTranslatedLines: onTranslated,
          },
        );
      },
      commit: async (selection, chapterId, translation) => {
        await repository.updateTranslation(
          bookId.value,
          chapterId,
          selection.source,
          translation,
        );
      },
      persistDraft: async (selection, chapter, values) => {
        const stored = await repository.upsertReaderAutomaticTranslationCache(
          createReaderAutomaticTranslationCache({
            bookId: bookId.value,
            chapterId: values[0]!.chapterId,
            selection,
            contentRevision: getReaderAutomaticTranslationContentRevision({
              segmentIds: chapter.segmentIds,
              paragraphs: chapter.paragraphs,
            }),
            chapter,
            values,
          }),
        );
        return stored !== undefined;
      },
      onChapterAlreadyComplete: discardAutomaticTranslationChapterDraft,
      onDraft: (selection, values) => {
        showAutomaticTranslationDraft(selection, values);
        if ((selection.purpose ?? 'automatic') === 'automatic') {
          scheduleAutomaticTranslation();
        }
      },
      onCommitted: (selection, chapterId) => {
        void markAutomaticTranslationCommitted(selection, chapterId);
      },
      onRetranslationComplete: handleRetranslationComplete,
    },
  );
  await coordinator.translateTargets({
    generation: automaticTranslationSession.currentGeneration(),
    selection: runtime.selection,
    targets: planned.all,
    glossary: runtime.glossary,
    concurrency: runtime.concurrency,
    maximumChunkParagraphs: settings.value.autoTranslationChunkParagraphs,
    maximumChunkCharacters:
      runtime.selection.source === 'gpt'
        ? openAiTranslationSegmentBudget
        : runtime.config.id === 'sakura'
          ? runtime.config.segLength
          : 1,
    chunkParagraphOverhead: runtime.selection.source === 'gpt' ? 4 : 0,
    signal: controller.signal,
  });
};

const runAutomaticTranslation = async () => {
  if (automaticTranslationRunning) {
    automaticTranslationQueued = true;
    return;
  }
  automaticTranslationRunning = true;
  try {
    do {
      automaticTranslationQueued = false;
      const controller = automaticTranslationController;
      try {
        await runAutomaticTranslationOnce();
      } catch (reason) {
        if (
          controller === automaticTranslationController &&
          controller?.signal.aborted === false
        ) {
          message.error(`自动翻译失败：${String(reason)}`);
        }
      }
    } while (
      automaticTranslationQueued &&
      automaticTranslationController?.signal.aborted === false
    );
  } finally {
    automaticTranslationRunning = false;
  }
};

const scheduleAutomaticTranslation = () => {
  if (activeAutomaticTranslationRuntime === undefined) return;
  if (automaticTranslationTimer !== undefined) {
    window.clearTimeout(automaticTranslationTimer);
  }
  automaticTranslationTimer = window.setTimeout(() => {
    automaticTranslationTimer = undefined;
    void runAutomaticTranslation();
  }, 140);
};

const haltAutomaticTranslationRuntime = () => {
  automaticTranslationStartRequest += 1;
  if (automaticTranslationTimer !== undefined) {
    window.clearTimeout(automaticTranslationTimer);
    automaticTranslationTimer = undefined;
  }
  automaticTranslationController?.abort();
  automaticTranslationController = undefined;
  automaticTranslationSession.stop();
  activeAutomaticTranslationRuntime = undefined;
  automaticTranslationSource.value = undefined;
  automaticTranslationQueued = false;
};

const restoreRetranslationChapterDisplay = async (
  chapterId: string,
  targetBookId = bookId.value,
) => {
  const prefix = `${chapterId}\u0000`;
  [...temporaryTranslations.keys()]
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => temporaryTranslations.delete(key));
  if (retranslationChapterId.value === chapterId) {
    retranslationChapterId.value = undefined;
  }
  if (targetBookId !== bookId.value) return;
  const ready = result.value;
  if (
    ready?.kind !== 'ready' ||
    !loadedReaderChapters().some((chapter) => chapter.chapterId === chapterId)
  ) {
    return;
  }
  const anchoredChapterId = ready.chapter.chapterId;
  const anchor = captureReaderPosition();
  const adapter = await cachedAdapterPromise;
  adapter.invalidateChapter({ bookId: targetBookId, chapterId });
  const [chapter, chapters] = await Promise.all([
    adapter.getChapter({ bookId: targetBookId, chapterId }),
    adapter.getChapters(targetBookId),
  ]);
  if (targetBookId !== bookId.value || result.value?.kind !== 'ready') return;
  const latest = result.value;
  continuousChapters.value = continuousChapters.value.map((loaded) =>
    loaded.chapterId === chapterId ? chapter : loaded,
  );
  result.value = {
    ...latest,
    chapters,
    chapter: latest.chapter.chapterId === chapterId ? chapter : latest.chapter,
  };
  await nextTick();
  await nextTick();
  if (result.value?.chapter.chapterId === anchoredChapterId) {
    restoreReaderPosition(anchor);
  }
  updateViewportMetrics();
};

const stopAutomaticTranslation = (notify = true, restoreDisplay = true) => {
  const targetChapterId = retranslationChapterId.value;
  haltAutomaticTranslationRuntime();
  if (restoreDisplay && targetChapterId !== undefined) {
    void restoreRetranslationChapterDisplay(targetChapterId);
  } else if (targetChapterId !== undefined) {
    retranslationChapterId.value = undefined;
  }
  if (notify) message.info('已停止自动翻译');
};

const applyRetranslationDecision = async (replace: boolean) => {
  const pending = pendingRetranslation.value;
  if (pending === undefined) return;
  pendingRetranslation.value = undefined;
  showRetranslationDecision.value = false;
  try {
    if (replace) {
      const repository = await repositoryPromise;
      await repository.updateTranslation(
        pending.bookId,
        pending.chapterId,
        pending.selection.source,
        pending.translation,
      );
      automaticTranslationSession.clearChapter(
        pending.selection,
        pending.chapterId,
      );
    }
    await restoreRetranslationChapterDisplay(pending.chapterId, pending.bookId);
    message.success(
      replace ? '当前章译文已替换' : '已保留原译文，重翻结果仍在缓存中',
    );
    const runtime = activeAutomaticTranslationRuntime;
    if (
      pending.nextChapterId !== undefined &&
      runtime !== undefined &&
      automaticTranslationSession.isActive(pending.selection)
    ) {
      runtime.targetChapterId = pending.nextChapterId;
      retranslationChapterId.value = pending.nextChapterId;
      scheduleAutomaticTranslation();
    } else {
      haltAutomaticTranslationRuntime();
      retranslationChapterId.value = undefined;
    }
  } catch (reason) {
    haltAutomaticTranslationRuntime();
    message.error(`无法处理重翻结果：${String(reason)}`);
    await restoreRetranslationChapterDisplay(pending.chapterId, pending.bookId);
  }
};

const handleRetranslationComplete = async (
  selection: ReaderAutomaticTranslationSelection,
  chapterId: string,
  translation: ChapterTranslation,
) => {
  if (
    !automaticTranslationSession.isActive(selection) ||
    pendingRetranslation.value !== undefined
  ) {
    return;
  }
  const runtime = activeAutomaticTranslationRuntime;
  const nextChapterId =
    runtime?.retranslation === undefined || result.value?.kind !== 'ready'
      ? undefined
      : resolveNextReaderRetranslationChapter(
          result.value.chapters,
          chapterId,
          runtime.retranslation,
        );
  pendingRetranslation.value = {
    bookId: bookId.value,
    selection,
    chapterId,
    translation,
    nextChapterId,
  };
  if (settings.value.retranslationPolicy === 'replace') {
    await applyRetranslationDecision(true);
    return;
  }
  if (settings.value.retranslationPolicy === 'keep') {
    await applyRetranslationDecision(false);
    return;
  }
  showRetranslationDecision.value = true;
};

const restoreAutomaticTranslationDraft = async (
  selection: ReaderAutomaticTranslationSelection,
) => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return;
  const anchor = captureReaderPosition();
  const chapterIds = loadedReaderChapters().map(({ chapterId }) => chapterId);
  temporaryTranslations.clear();
  chapterIds.forEach((chapterId) => {
    automaticTranslationSession
      .entries(selection, chapterId)
      .forEach(({ segmentId, translated }) => {
        temporaryTranslations.set(
          temporaryTranslationKey(chapterId, segmentId),
          translated,
        );
      });
  });
  const repository = await repositoryPromise;
  const sourceAdapter = createLocalVolumeReaderAdapter(repository, [
    selection.source,
  ]);
  const refreshedChapters = await Promise.all(
    chapterIds.map(async (chapterId) =>
      withTemporaryTranslations(
        await sourceAdapter.getChapter({
          bookId: bookId.value,
          chapterId,
        }),
      ),
    ),
  );
  if (!automaticTranslationSession.isActive(selection)) return;
  const refreshedById = new Map(
    refreshedChapters.map((chapter) => [chapter.chapterId, chapter]),
  );
  continuousChapters.value = continuousChapters.value.map(
    (chapter) => refreshedById.get(chapter.chapterId) ?? chapter,
  );
  const chapter = refreshedById.get(ready.chapter.chapterId) ?? ready.chapter;
  result.value = { ...ready, chapter };
  enableTemporaryReadingModes(chapter);
  await nextTick();
  await nextTick();
  restoreReaderPosition(anchor);
  updateViewportMetrics();
};

const resolveConfiguredAutomaticTranslationWorker = (
  source: ReaderAutomaticTranslationSource,
) =>
  source === 'gpt'
    ? resolveReaderAutomaticTranslationWorker(
        gptWorkspace.ref.value.workers,
        selectedAutomaticGptWorkerId.value,
      )
    : resolveReaderAutomaticTranslationWorker(
        sakuraWorkspace.ref.value.workers,
        selectedAutomaticSakuraWorkerId.value,
      );

const hydrateAutomaticTranslationDrafts = async (
  selection: ReaderAutomaticTranslationSelection,
  request: number,
  targetBookId: string,
) => {
  const repository = await repositoryPromise;
  const expectedSelectionKey =
    getReaderAutomaticTranslationSelectionCacheKey(selection);
  const allCaches =
    await repository.listReaderAutomaticTranslationCaches(targetBookId);
  const chapterRequests = new Map<
    string,
    ReturnType<typeof repository.getChapter>
  >();
  const chapters = new Map<
    string,
    Awaited<ReturnType<typeof repository.getChapter>>
  >();
  const staleCacheKeys = new Set<string>();
  await Promise.all(
    allCaches.map(async (cache) => {
      let chapterRequest = chapterRequests.get(cache.chapterId);
      if (chapterRequest === undefined) {
        chapterRequest = repository.getChapter(targetBookId, cache.chapterId);
        chapterRequests.set(cache.chapterId, chapterRequest);
      }
      const chapter = await chapterRequest;
      chapters.set(cache.chapterId, chapter);
      const stale =
        chapter === undefined ||
        getReaderAutomaticTranslationContentRevision({
          segmentIds: chapter.segmentIds,
          paragraphs: chapter.paragraphs,
        }) !== cache.contentRevision ||
        (cache.purpose === 'retranslate' &&
          cache.formalTranslationRevision !==
            getChapterFormalTranslationRevision(chapter));
      if (stale) {
        staleCacheKeys.add(cache.key);
      }
    }),
  );
  await Promise.all(
    [...staleCacheKeys].map((key) =>
      repository.deleteReaderAutomaticTranslationCache(key),
    ),
  );
  const caches = allCaches.filter(
    (cache) =>
      !staleCacheKeys.has(cache.key) &&
      cache.purpose === (selection.purpose ?? 'automatic') &&
      cache.source === selection.source &&
      cache.selectionKey === expectedSelectionKey &&
      cache.glossaryId === selection.glossaryId,
  );
  await Promise.all(
    caches.map(async (cache) => {
      const chapter = chapters.get(cache.chapterId);
      if (
        request !== automaticTranslationStartRequest ||
        bookId.value !== targetBookId ||
        !automaticTranslationSession.isActive(selection) ||
        chapter === undefined ||
        getReaderAutomaticTranslationContentRevision({
          segmentIds: chapter.segmentIds,
          paragraphs: chapter.paragraphs,
        }) !== cache.contentRevision ||
        (cache.purpose === 'retranslate' &&
          cache.formalTranslationRevision !==
            getChapterFormalTranslationRevision(chapter))
      ) {
        return;
      }
      automaticTranslationSession.hydrate(
        selection,
        cache.entries.map((entry) => ({
          chapterId: cache.chapterId,
          ...entry,
        })),
      );
    }),
  );
};

const startAutomaticTranslation = async (
  source: ReaderAutomaticTranslationSource,
  notify = true,
  purpose: ReaderAutomaticTranslationSelection['purpose'] = 'automatic',
  targetChapterId?: string,
  retranslation?: ReaderRetranslationOptions,
) => {
  const request = ++automaticTranslationStartRequest;
  const worker = resolveConfiguredAutomaticTranslationWorker(source);
  if (worker === undefined) {
    stopAutomaticTranslation(false);
    message.warning(
      `请先在${source === 'gpt' ? 'GPT' : 'Sakura'}工作区配置翻译器`,
    );
    return false;
  }
  try {
    const targetBookId = bookId.value;
    const previousRetranslationChapterId = retranslationChapterId.value;
    automaticTranslationController?.abort();
    automaticTranslationSession.stop();
    if (previousRetranslationChapterId !== undefined) {
      await restoreRetranslationChapterDisplay(previousRetranslationChapterId);
    }
    if (request !== automaticTranslationStartRequest) return false;
    const volume = await (await repositoryPromise).getVolume(targetBookId);
    if (
      request !== automaticTranslationStartRequest ||
      bookId.value !== targetBookId
    ) {
      return false;
    }
    if (volume === undefined) throw new Error('书籍不存在');
    const config = createVisibleTranslationConfig(source, worker);
    const selection: ReaderAutomaticTranslationSelection = {
      source,
      workerId: worker.id,
      workerFingerprint: JSON.stringify(config),
      cacheFingerprint: JSON.stringify(
        source === 'gpt'
          ? {
              model: (worker as GptWorker).model,
              endpoint: worker.endpoint,
            }
          : {
              endpoint: worker.endpoint,
              segLength: (worker as SakuraWorker).segLength,
              prevSegLength: (worker as SakuraWorker).prevSegLength,
            },
      ),
      glossaryId: volume.glossaryId,
      purpose,
    };
    automaticTranslationSession.start(selection);
    automaticTranslationController = new AbortController();
    activeAutomaticTranslationRuntime = {
      selection,
      config,
      concurrency: normalizeTranslationConcurrency(worker.concurrency),
      glossary: { ...volume.glossary },
      targetChapterId,
      retranslation,
    };
    automaticTranslationSource.value = source;
    retranslationChapterId.value =
      purpose === 'retranslate' ? targetChapterId : undefined;
    temporaryMode = readingMode.value;
    await hydrateAutomaticTranslationDrafts(selection, request, targetBookId);
    if (
      request !== automaticTranslationStartRequest ||
      !automaticTranslationSession.isActive(selection)
    ) {
      return false;
    }
    await restoreAutomaticTranslationDraft(selection);
    if (
      request !== automaticTranslationStartRequest ||
      !automaticTranslationSession.isActive(selection)
    ) {
      return false;
    }
    showMobileTranslationNotice.value = false;
    (document.activeElement as HTMLElement | null)?.blur();
    if (notify) {
      message.success(
        purpose === 'retranslate'
          ? `已开始使用 ${source === 'gpt' ? 'GPT' : 'Sakura'} ${
              retranslation?.scope === 'continuous'
                ? '连续重新翻译'
                : '重新翻译当前章'
            }`
          : `已开启 ${source === 'gpt' ? 'GPT' : 'Sakura'} 自动翻译`,
      );
    }
    await nextTick();
    scheduleAutomaticTranslation();
    return true;
  } catch (reason) {
    if (request !== automaticTranslationStartRequest) return false;
    stopAutomaticTranslation(false);
    message.error(`无法启动自动翻译：${String(reason)}`);
    return false;
  }
};

const isCurrentChapterRetranslating = computed(
  () =>
    retranslationChapterId.value !== undefined &&
    activeAutomaticTranslationRuntime?.selection.purpose === 'retranslate',
);

const toggleCurrentChapterRetranslation = () => {
  if (isCurrentChapterRetranslating.value) {
    stopAutomaticTranslation();
    return;
  }
  if (result.value?.kind !== 'ready') return;
  if (!canRetranslateCurrentChapter.value) return;
  retranslationScope.value = 'chapter';
  retranslationUntranslatedPolicy.value = 'stop';
  showTools.value = false;
  showRetranslationSelection.value = true;
};

const startCurrentChapterRetranslation = async (
  source: ReaderAutomaticTranslationSource,
) => {
  if (result.value?.kind !== 'ready' || !canRetranslateCurrentChapter.value) {
    showRetranslationSelection.value = false;
    return;
  }
  const chapterId = result.value.chapter.chapterId;
  showRetranslationSelection.value = false;
  await startAutomaticTranslation(source, true, 'retranslate', chapterId, {
    scope: retranslationScope.value,
    untranslatedPolicy: retranslationUntranslatedPolicy.value,
  });
};

const toggleAutomaticTranslation = async (
  source: ReaderAutomaticTranslationSource,
) => {
  if (ordinaryAutomaticTranslationSource.value === source) {
    stopAutomaticTranslation();
    return;
  }
  await startAutomaticTranslation(source);
};

const selectAutomaticTranslationWorker = async (
  source: ReaderAutomaticTranslationSource,
  workerId: string,
) => {
  if (source === 'gpt') selectedAutomaticGptWorkerId.value = workerId;
  else selectedAutomaticSakuraWorkerId.value = workerId;
  if (automaticTranslationSource.value !== source) return;
  const runtime = activeAutomaticTranslationRuntime;
  if (
    await startAutomaticTranslation(
      source,
      false,
      runtime?.selection.purpose,
      runtime?.targetChapterId,
      runtime?.retranslation,
    )
  ) {
    message.success(`已切换 ${source === 'gpt' ? 'GPT' : 'Sakura'} 翻译器`);
  }
};

const automaticGptWorkerValue = computed<string | null>({
  get: () => resolveConfiguredAutomaticTranslationWorker('gpt')?.id ?? null,
  set: (workerId) => {
    if (workerId !== null)
      void selectAutomaticTranslationWorker('gpt', workerId);
  },
});

const automaticSakuraWorkerValue = computed<string | null>({
  get: () => resolveConfiguredAutomaticTranslationWorker('sakura')?.id ?? null,
  set: (workerId) => {
    if (workerId !== null) {
      void selectAutomaticTranslationWorker('sakura', workerId);
    }
  },
});

const loadBookmarks = async (targetBookId = bookId.value) => {
  const repository = await repositoryPromise;
  const values = await repository.listReaderBookmarks(targetBookId);
  if (targetBookId === bookId.value) {
    bookmarks.value = sortReaderBookmarks(values);
  }
};

const activeViewportBookmark = computed(() =>
  viewportChapterId.value === undefined || viewportSegmentId.value === undefined
    ? undefined
    : findBookmarkAtSegment(
        bookmarks.value,
        viewportChapterId.value,
        viewportSegmentId.value,
      ),
);

const toggleBookmark = async () => {
  if (result.value?.kind !== 'ready') {
    return;
  }
  const anchor = captureReaderPosition();
  if (anchor === undefined) {
    message.warning('当前章节没有可书签定位的段落');
    return;
  }
  const repository = await repositoryPromise;
  const existing = findBookmarkAtSegment(
    bookmarks.value,
    anchor.chapterId,
    anchor.segmentId,
  );
  if (existing !== undefined) {
    await repository.deleteReaderBookmark(existing.id);
    message.success('已移除书签');
  } else {
    await repository.putReaderBookmark(
      createReaderBookmark({
        bookId: result.value.book.id,
        chapterId: anchor.chapterId,
        segmentId: anchor.segmentId,
        sourceLine: anchor.sourceLine,
        languageSide: anchor.languageSide,
        offsetRatio: anchor.offsetRatio,
        viewportTopOffset: anchor.viewportTopOffset,
        label: displayReaderTitle(
          result.value.chapters.find(({ id }) => id === anchor.chapterId) ??
            result.value.chapter,
        ),
      }),
    );
    message.success('已添加书签');
  }
  await loadBookmarks(result.value.book.id);
  viewportChapterId.value = anchor.chapterId;
  viewportSegmentId.value = anchor.segmentId;
};

const openBookmark = (bookmark: ReaderBookmark) => {
  showBookmarks.value = false;
  const target = getBookmarkTarget(bookmark);
  if (
    result.value?.kind === 'ready' &&
    result.value.chapter.chapterId === target.chapterId
  ) {
    if (target.segmentId === undefined || target.offsetRatio === undefined)
      scrollToSegment(target.segmentId);
    else
      restoreReaderPosition({
        chapterId: target.chapterId,
        segmentId: target.segmentId,
        languageSide: target.languageSide,
        offsetRatio: target.offsetRatio,
        viewportTopOffset: target.viewportTopOffset ?? 0,
      });
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
  const target = getBookmarkTarget(bookmark);
  if (target.segmentId === undefined || target.offsetRatio === undefined)
    scrollToSegment(target.segmentId);
  else
    restoreReaderPosition({
      chapterId: target.chapterId,
      segmentId: target.segmentId,
      languageSide: target.languageSide,
      offsetRatio: target.offsetRatio,
      viewportTopOffset: target.viewportTopOffset ?? 0,
    });
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
    scrollToSegment(segment?.id);
  } else if (
    resolvedFlow.value === 'paginated' &&
    progress?.scrollRatio !== undefined &&
    readerViewport.value !== null
  ) {
    const metrics = getReaderPageMetrics(readerViewport.value);
    positionReaderPage(
      readerViewport.value,
      Math.round(progress.scrollRatio * Math.max(0, metrics.pageCount - 1)),
    );
  } else if (progress?.scrollRatio !== undefined) {
    const scrollable =
      document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({
      top: Math.max(0, scrollable) * progress.scrollRatio,
      behavior: 'auto',
    });
  }
};

const saveProgress = async () => {
  if (result.value?.kind !== 'ready') {
    return;
  }
  const segmentId = getActiveSegmentId();
  const activeChapterElement =
    resolvedFlow.value === 'scrolled'
      ? getActiveContinuousChapterElement()
      : undefined;
  const activeChapterId =
    activeChapterElement?.dataset.readerChapterId ??
    result.value.chapter.chapterId;
  const scrollRatio =
    resolvedFlow.value === 'paginated' && readerViewport.value !== null
      ? getReaderPageMetrics(readerViewport.value).ratio
      : activeChapterElement !== undefined
        ? (() => {
            const rect = activeChapterElement.getBoundingClientRect();
            const scrollable = Math.max(1, rect.height - window.innerHeight);
            return Math.max(0, Math.min(1, -rect.top / scrollable));
          })()
        : (() => {
            const scrollable =
              document.documentElement.scrollHeight - window.innerHeight;
            return scrollable <= 0 ? 0 : window.scrollY / scrollable;
          })();
  const repository = await repositoryPromise;
  const sourceLine =
    segmentId === undefined
      ? undefined
      : getSegmentSourceLine(activeChapterId, segmentId);
  await repository.putReaderProgress(
    createReaderProgress({
      bookId: result.value.book.id,
      chapterId: activeChapterId,
      segmentId,
      sourceLine,
      scrollRatio,
    }),
  );
};

const saveProgressThrottled = useThrottleFn(() => {
  updateViewportMetrics();
  void saveProgress();
}, 400);

const handleVisibilityChange = () => {
  if (document.hidden) {
    void saveProgress();
    void recordReadingTime();
  } else if (result.value?.kind === 'ready') {
    startReadingTime(result.value.book.id);
  }
};

const navigate = (
  chapterId: string,
  edge?: 'start' | 'end',
  preservePanels = false,
) => {
  pendingChapterEdge = edge;
  void saveProgress();
  void recordReadingTime();
  stopSpeaking();
  if (!preservePanels) closeReaderPanels();
  void router.push(
    `/books/${encodeURIComponent(bookId.value)}/read/${encodeURIComponent(chapterId)}`,
  );
};

const navigateToEpubHref = (href: string, preservePanels = false) => {
  if (result.value?.kind !== 'ready') return;
  const key = normalizeEpubHrefKey(href);
  const target = result.value.chapter.epub?.linkTargets.find(
    (item) => normalizeEpubHrefKey(item.href) === key,
  );
  if (target === undefined) {
    message.warning('此 EPUB 链接没有可读取的目标');
    return;
  }
  pendingChapterEdge = undefined;
  void saveProgress();
  void recordReadingTime();
  stopSpeaking();
  if (!preservePanels) closeReaderPanels();
  void router.push({
    path: `/books/${encodeURIComponent(bookId.value)}/read/${encodeURIComponent(target.chapterId)}`,
    query: { epub: href },
  });
};

const backHome = () => void router.push('/');
const openDetails = () =>
  void router.push('/books/' + encodeURIComponent(bookId.value) + '/details');
const chapterSummaryById = computed(() => {
  const chapters = new Map<string, ReaderChapterSummary>();
  if (result.value?.kind === 'ready') {
    result.value.chapters.forEach((chapter) =>
      chapters.set(chapter.id, chapter),
    );
  }
  return chapters;
});

const navigateFromCatalog = (entry: ReaderNavigationEntry) => {
  if (catalogParentIds.value.has(entry.id)) {
    toggleCatalogEntry(entry.id);
    return;
  }
  if (entry.href !== undefined && result.value?.chapter.epub !== undefined) {
    navigateToEpubHref(entry.href);
  } else if (entry.chapterId !== undefined) {
    navigate(entry.chapterId);
  }
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

const scrolledChapterTransitions = computed(() => {
  if (result.value?.kind !== 'ready') return {};
  const input = {
    chapters: result.value.chapters,
    navigation: result.value.navigation,
    currentIndex: currentChapterIndex.value,
  };
  return {
    previous: planReaderChapterTransition({ ...input, direction: 'previous' }),
    next: planReaderChapterTransition({ ...input, direction: 'next' }),
  };
});

const getScrolledChapterTransition = (direction: 'previous' | 'next') =>
  scrolledChapterTransitions.value[direction];

const isScrolledChapterCheckpoint = (
  direction: 'previous' | 'next',
  summaryIndex: number,
) => getScrolledChapterTransition(direction)?.checkpointIndex === summaryIndex;

function navigateScrolledChapterBoundary(
  direction: 'previous' | 'next',
  requireDocumentBoundary = true,
): boolean {
  if (chapterBoundaryNavigationPending) return false;
  const atBoundary =
    direction === 'previous'
      ? window.scrollY <= 2
      : window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2;
  if (requireDocumentBoundary && !atBoundary) return false;
  const transition = getScrolledChapterTransition(direction);
  const chapterId =
    transition === undefined || result.value?.kind !== 'ready'
      ? undefined
      : result.value.chapters[transition.targetIndex]?.id;
  if (chapterId === undefined) return false;
  chapterBoundaryNavigationPending = true;
  navigate(chapterId, direction === 'previous' ? 'end' : 'start');
  return true;
}

const getChapterPreviewElement = (direction: 'previous' | 'next') =>
  document.querySelector<HTMLElement>(
    `[data-reader-chapter-preview="${direction}"][data-reader-adjacent-preview="true"]`,
  );

function syncScrolledPreviewBoundary() {
  const direction = scrolledPreviewInputDirection;
  if (
    direction === undefined ||
    performance.now() - scrolledPreviewInputAt > 500 ||
    chapterBoundaryNavigationPending
  ) {
    return;
  }
  const preview = getChapterPreviewElement(direction);
  if (preview === null) return;
  const rect = preview.getBoundingClientRect();
  const atDocumentBoundary =
    direction === 'next'
      ? window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
      : window.scrollY <= 2;
  const crossedBoundary =
    direction === 'next'
      ? rect.top <= getReaderVisibleTop() + 1 || atDocumentBoundary
      : rect.bottom >= getReaderVisibleBottom() - 1 || atDocumentBoundary;
  if (crossedBoundary) {
    scrolledPreviewInputDirection = undefined;
    navigateScrolledChapterBoundary(direction, false);
  }
}

function scheduleScrolledPreviewBoundarySync() {
  if (scrolledPreviewBoundaryFrame !== undefined) {
    cancelAnimationFrame(scrolledPreviewBoundaryFrame);
  }
  scrolledPreviewBoundaryFrame = requestAnimationFrame(() => {
    scrolledPreviewBoundaryFrame = undefined;
    syncScrolledPreviewBoundary();
  });
}

const continuousChapterElements = () => [
  ...document.querySelectorAll<HTMLElement>('[data-reader-chapter-id]'),
];

const getActiveContinuousChapterElement = () => {
  const elements = continuousChapterElements();
  if (elements.length === 0) return undefined;
  if (window.scrollY <= 2) return elements[0];
  if (
    window.scrollY + window.innerHeight >=
    document.documentElement.scrollHeight - 2
  ) {
    return elements.at(-1);
  }
  const readingLine = getReaderVisibleTop() + 8;
  return (
    elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top <= readingLine && rect.bottom > readingLine;
    }) ??
    elements.reduce((closest, element) => {
      const distance = Math.abs(
        element.getBoundingClientRect().top - readingLine,
      );
      const closestDistance = Math.abs(
        closest.getBoundingClientRect().top - readingLine,
      );
      return distance < closestDistance ? element : closest;
    })
  );
};

const getContinuousChapterElement = (chapterId: string) =>
  continuousChapterElements().find(
    (element) => element.dataset.readerChapterId === chapterId,
  );

const getChapterPreviews = (direction: ReaderContinuousBufferDirection) =>
  direction === 'previous'
    ? previousChapterPreviews.value
    : nextChapterPreviews.value;

const setChapterPreviews = (
  direction: ReaderContinuousBufferDirection,
  previews: ReaderChapterPreview[],
) => {
  if (direction === 'previous') previousChapterPreviews.value = previews;
  else nextChapterPreviews.value = previews;
};

const getPreviewSegments = (preview: ReaderChapterPreview) =>
  preview.chapter.segments.slice(preview.start, preview.end);

const createChapterPreview = (
  chapter: ReaderChapterContent,
  summaryIndex: number,
  direction: ReaderContinuousBufferDirection,
): ReaderChapterPreview => {
  const segmentCount = chapter.segments.length;
  return direction === 'previous'
    ? {
        chapter,
        summaryIndex,
        start: Math.max(
          0,
          segmentCount - readerContinuousBufferSegmentBatchSize,
        ),
        end: segmentCount,
      }
    : {
        chapter,
        summaryIndex,
        start: 0,
        end: Math.min(segmentCount, readerContinuousBufferSegmentBatchSize),
      };
};

const getPreviewBufferHeight = (direction: ReaderContinuousBufferDirection) => {
  const elements = [
    ...document.querySelectorAll<HTMLElement>(
      `[data-reader-chapter-preview="${direction}"]`,
    ),
  ];
  if (elements.length === 0) return 0;
  const first = elements[0]?.getBoundingClientRect();
  const last = elements.at(-1)?.getBoundingClientRect();
  return first === undefined || last === undefined
    ? 0
    : Math.max(0, last.bottom - first.top);
};

const waitForContinuousPreviewLayout = async () => {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const applyChapterPreviews = async (
  direction: ReaderContinuousBufferDirection,
  previews: ReaderChapterPreview[],
  chapterId: string,
) => {
  const previousTop =
    direction === 'previous'
      ? getContinuousChapterElement(chapterId)?.getBoundingClientRect().top
      : undefined;
  setChapterPreviews(direction, previews);
  await waitForContinuousPreviewLayout();
  scheduleAutomaticTranslation();
  if (previousTop === undefined) return;
  const nextTop =
    getContinuousChapterElement(chapterId)?.getBoundingClientRect().top;
  if (nextTop !== undefined && Math.abs(nextTop - previousTop) > 0.5) {
    window.scrollBy({ top: nextTop - previousTop, behavior: 'auto' });
  }
};

const fillContinuousPreviewDirection = async (
  direction: ReaderContinuousBufferDirection,
  generation: number,
  fillRequest: number,
  chapter: ReaderChapterContent,
  chapters: ReaderChapterSummary[],
) => {
  const currentChapterIndex = chapters.findIndex(
    ({ id }) => id === chapter.chapterId,
  );
  if (currentChapterIndex < 0) return;
  for (let step = 0; step < 100; step += 1) {
    if (
      generation !== scrolledPreviewGeneration ||
      fillRequest !== scrolledPreviewFillRequest ||
      resolvedFlow.value !== 'scrolled'
    ) {
      return;
    }
    await waitForContinuousPreviewLayout();
    if (
      generation !== scrolledPreviewGeneration ||
      fillRequest !== scrolledPreviewFillRequest
    ) {
      return;
    }
    const previews = getChapterPreviews(direction);
    const activePreview =
      direction === 'previous' ? previews[0] : previews.at(-1);
    const adjacentSummaryIndex =
      (activePreview?.summaryIndex ?? currentChapterIndex) +
      (direction === 'previous' ? -1 : 1);
    const checkpointIndex =
      getScrolledChapterTransition(direction)?.checkpointIndex;
    const hasCheckpoint = previews.some(
      ({ summaryIndex }) => summaryIndex === checkpointIndex,
    );
    const decision = planReaderContinuousBuffer({
      renderedHeight: hasCheckpoint ? getPreviewBufferHeight(direction) : 0,
      targetHeight: getReaderContinuousBufferTarget(
        getReaderVisibleBottom() - getReaderVisibleTop(),
        direction,
      ),
      chapterCount: previews.length,
      segmentCount: previews.reduce(
        (count, preview) => count + preview.end - preview.start,
        0,
      ),
      currentChapterRemainingSegments:
        activePreview === undefined
          ? 0
          : direction === 'previous'
            ? activePreview.start
            : activePreview.chapter.segments.length - activePreview.end,
      hasAdjacentChapter: chapters[adjacentSummaryIndex] !== undefined,
    });
    if (decision.kind === 'stop') return;
    if (decision.kind === 'expand-segments' && activePreview !== undefined) {
      await applyChapterPreviews(
        direction,
        previews.map((preview) =>
          preview !== activePreview
            ? preview
            : direction === 'previous'
              ? {
                  ...preview,
                  start: Math.max(0, preview.start - decision.count),
                }
              : {
                  ...preview,
                  end: Math.min(
                    preview.chapter.segments.length,
                    preview.end + decision.count,
                  ),
                },
        ),
        chapter.chapterId,
      );
      continue;
    }
    const summary = chapters[adjacentSummaryIndex];
    if (decision.kind !== 'load-chapter' || summary === undefined) return;
    try {
      const adapter = await cachedAdapterPromise;
      const loaded = withTemporaryTranslations(
        await adapter.getChapter({
          bookId: bookId.value,
          chapterId: summary.id,
        }),
      );
      if (
        generation !== scrolledPreviewGeneration ||
        fillRequest !== scrolledPreviewFillRequest
      ) {
        return;
      }
      const preview = createChapterPreview(
        loaded,
        adjacentSummaryIndex,
        direction,
      );
      await applyChapterPreviews(
        direction,
        direction === 'previous'
          ? [preview, ...getChapterPreviews(direction)]
          : [...getChapterPreviews(direction), preview],
        chapter.chapterId,
      );
    } catch {
      return;
    }
  }
};

const scheduleContinuousPreviewFill = (
  generation: number,
  chapter: ReaderChapterContent,
  chapters: ReaderChapterSummary[],
) => {
  const fillRequest = ++scrolledPreviewFillRequest;
  if (scrolledPreviewFillFrame !== undefined) {
    cancelAnimationFrame(scrolledPreviewFillFrame);
  }
  scrolledPreviewFillFrame = requestAnimationFrame(() => {
    scrolledPreviewFillFrame = undefined;
    void Promise.all([
      fillContinuousPreviewDirection(
        'previous',
        generation,
        fillRequest,
        chapter,
        chapters,
      ),
      fillContinuousPreviewDirection(
        'next',
        generation,
        fillRequest,
        chapter,
        chapters,
      ),
    ]);
  });
};

function scheduleCurrentContinuousPreviewFill() {
  if (resolvedFlow.value !== 'scrolled' || result.value?.kind !== 'ready') {
    return;
  }
  const currentChapter =
    continuousChapters.value.find(
      (chapter) => chapter.chapterId === requestedChapterId.value,
    ) ?? result.value.chapter;
  scheduleContinuousPreviewFill(
    scrolledPreviewGeneration,
    currentChapter,
    result.value.chapters,
  );
}

const initializeContinuousChapters = async (
  chapter: ReaderChapterContent,
  chapters: ReaderChapterSummary[],
) => {
  const generation = ++scrolledPreviewGeneration;
  if (resolvedFlow.value !== 'scrolled') {
    scrolledPreviewFillRequest += 1;
    if (scrolledPreviewFillFrame !== undefined) {
      cancelAnimationFrame(scrolledPreviewFillFrame);
      scrolledPreviewFillFrame = undefined;
    }
    previousChapterPreviews.value = [];
    nextChapterPreviews.value = [];
    continuousChapters.value = [];
    chapterBoundaryNavigationPending = false;
    return;
  }
  previousChapterPreviews.value = [];
  nextChapterPreviews.value = [];
  continuousChapterInitialSegments.clear();
  continuousChapterInitialSegments.set(
    chapter.chapterId,
    initialSegmentId.value ?? chapter.segments[0]?.id,
  );
  continuousChapters.value = [chapter];
  scrolledPreviewInputDirection = undefined;
  chapterBoundaryNavigationPending = false;
  scheduleContinuousPreviewFill(generation, chapter, chapters);
};

const chapterProgressPercent = computed(() => {
  if (result.value?.kind !== 'ready' || result.value.chapters.length === 0) {
    return 0;
  }
  return (
    ((currentChapterIndex.value + viewportProgressRatio.value) /
      result.value.chapters.length) *
    100
  );
});

const updateCurrentTime = () => {
  currentTime.value = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
};

let currentTimeTimer: number | undefined;

const completedTranslationTasks = computed(() =>
  [
    ...gptWorkspace.ref.value.jobRecords,
    ...sakuraWorkspace.ref.value.jobRecords,
  ]
    .filter(TranslateJob.isFinished)
    .map((job) => job.task),
);

const refreshCurrentChapter = async () => {
  if (result.value?.kind !== 'ready') return;
  showTools.value = false;
  const chapterId = result.value.chapter.chapterId;
  await saveProgress();
  const adapter = await cachedAdapterPromise;
  adapter.invalidateChapter({ bookId: bookId.value, chapterId });
  await load();
};

let initializedCatalogBookId: string | undefined;
watch(
  result,
  (loaded) => {
    if (loaded?.kind !== 'ready') return;
    if (initializedCatalogBookId === loaded.book.id) return;
    initializedCatalogBookId = loaded.book.id;
    collapsedCatalogEntryIds.value = new Set(
      loaded.navigation.flatMap(({ parentId }) =>
        parentId === undefined ? [] : [parentId],
      ),
    );
  },
  { immediate: true },
);

watch(
  () => [bookId.value, requestedChapterId.value],
  ([nextBookId, nextChapterId], previous) => {
    if (previous !== undefined && nextBookId !== previous[0]) {
      stopAutomaticTranslation(false, false);
      automaticTranslationSession.clearDrafts();
      temporaryTranslations.clear();
      searchUiRequestId += 1;
      void searchControllerPromise.then((controller) => controller.cancel());
      searchQuery.value = '';
      searchResults.value = [];
      searchTruncated.value = false;
      searchLoading.value = false;
    }
    if (
      resolvedFlow.value === 'scrolled' &&
      result.value?.kind === 'ready' &&
      result.value.book.id === nextBookId &&
      nextChapterId !== undefined
    ) {
      const loadedChapter = continuousChapters.value.find(
        (chapter) => chapter.chapterId === nextChapterId,
      );
      if (loadedChapter !== undefined) {
        result.value = { ...result.value, chapter: loadedChapter };
        const edge = pendingChapterEdge;
        pendingChapterEdge = undefined;
        void nextTick().then(() => {
          if (requestedSegmentId.value !== undefined) {
            scrollToSegment(requestedSegmentId.value);
            return;
          }
          const element = getContinuousChapterElement(nextChapterId);
          if (element === undefined) return;
          const rect = element.getBoundingClientRect();
          window.scrollBy({
            top:
              edge === 'end'
                ? rect.bottom - window.innerHeight
                : rect.top - getReaderVisibleTop(),
            behavior: 'auto',
          });
        });
        return;
      }
    }
    void load();
  },
  { immediate: true },
);

watch(requestedEpubHref, (href) => {
  if (href === undefined) return;
  void nextTick().then(() => scrollToEpubHref(href));
});
watch(searchQuery, () => {
  searchUiRequestId += 1;
  searchResults.value = [];
  searchTruncated.value = false;
  if (searchLoading.value) {
    searchLoading.value = false;
    void searchControllerPromise.then((controller) => controller.cancel());
  }
});
watch(showReaderGlossary, (show) => {
  if (show) return;
  readerGlossaryRequest += 1;
  readerGlossaryError.value = '';
});
watch(completedTranslationTasks, (tasks, previousTasks) => {
  const completedCurrentTask = tasks.find(
    (task) => !previousTasks.includes(task) && taskTargetsCurrentChapter(task),
  );
  if (completedCurrentTask === undefined) return;
  const chapterId = currentChapterSummary.value?.id;
  if (chapterId !== undefined) void adoptCompletedChapterTranslation(chapterId);
});

watch(
  settings,
  async (value) => {
    if (!settingsLoaded) {
      return;
    }
    try {
      const repository = await repositoryPromise;
      await repository.putReaderSettings(
        serializeReaderSettings({ ...value, updatedAt: Date.now() }),
      );
    } catch {
      message.error('无法保存阅读设置');
    }
  },
  { deep: true },
);

watch(bookId, (nextBookId, previousBookId) => {
  if (nextBookId !== previousBookId) {
    readerChineseScriptService.releaseBook(previousBookId);
  }
});

watch(resolvedFlow, async (_flow, previousFlow) => {
  const segmentId = getActiveSegmentId(previousFlow);
  if (result.value?.kind === 'ready') {
    await initializeContinuousChapters(
      result.value.chapter,
      result.value.chapters,
    );
  }
  await nextTick();
  await nextTick();
  scrollToSegment(segmentId);
  updateViewportMetrics();
});

watch(usesDoublePageSpread, async () => {
  if (resolvedFlow.value !== 'paginated') return;
  handleViewportResize();
});

watch(
  () => [
    viewportChapterId.value,
    viewportSegmentId.value,
    readerPageIndex.value,
    settings.value.autoTranslationPreloadParagraphs,
  ],
  () => scheduleAutomaticTranslation(),
);

watch(
  () => [
    JSON.stringify(gptWorkspace.ref.value.workers),
    JSON.stringify(sakuraWorkspace.ref.value.workers),
  ],
  () => {
    const source = automaticTranslationSource.value;
    if (source === undefined) return;
    const runtime = activeAutomaticTranslationRuntime;
    const worker = resolveConfiguredAutomaticTranslationWorker(source);
    const fingerprint =
      worker === undefined
        ? undefined
        : JSON.stringify(createVisibleTranslationConfig(source, worker));
    if (
      worker === undefined ||
      activeAutomaticTranslationRuntime?.selection.workerId !== worker.id ||
      activeAutomaticTranslationRuntime.selection.workerFingerprint !==
        fingerprint
    ) {
      void startAutomaticTranslation(
        source,
        false,
        runtime?.selection.purpose,
        runtime?.targetChapterId,
        runtime?.retranslation,
      );
    }
  },
);

watch(
  () => [
    activeSettings.value.fontSize,
    activeSettings.value.lineHeight,
    activeSettings.value.contentWidth,
    activeSettings.value.horizontalPadding,
  ],
  async () => {
    const anchor = captureReaderPosition();
    await nextTick();
    await nextTick();
    restoreReaderPosition(anchor);
    updateViewportMetrics();
    scheduleCurrentContinuousPreviewFill();
  },
);

onMounted(() => {
  void loadSettings();
  updateCurrentTime();
  currentTimeTimer = window.setInterval(updateCurrentTime, 30_000);
  window.addEventListener('scroll', handleViewportScroll, { passive: true });
  window.addEventListener('resize', handleViewportResize, { passive: true });
  window.addEventListener('keydown', handleReaderKeydown);
  document.addEventListener('selectionchange', updateReaderSelection);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});
onBeforeUnmount(() => {
  loadUiRequestId += 1;
  searchUiRequestId += 1;
  scrolledPreviewGeneration += 1;
  scrolledPreviewFillRequest += 1;
  void controllerPromise.then((controller) => controller.cancel());
  void searchControllerPromise.then((controller) => controller.cancel());
  stopAutomaticTranslation(false, false);
  automaticTranslationSession.clearDrafts();
  window.removeEventListener('scroll', handleViewportScroll);
  window.removeEventListener('resize', handleViewportResize);
  if (viewportResizeFrame !== undefined) {
    cancelAnimationFrame(viewportResizeFrame);
  }
  if (scrolledPreviewFillFrame !== undefined) {
    cancelAnimationFrame(scrolledPreviewFillFrame);
  }
  if (scrolledPreviewBoundaryFrame !== undefined) {
    cancelAnimationFrame(scrolledPreviewBoundaryFrame);
  }
  window.removeEventListener('keydown', handleReaderKeydown);
  document.removeEventListener('selectionchange', updateReaderSelection);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (currentTimeTimer !== undefined) window.clearInterval(currentTimeTimer);
  void saveProgress();
  void recordReadingTime();
  stopSpeaking();
});
</script>

<template>
  <n-config-provider
    tag="main"
    class="book-reader"
    :class="[
      `book-reader--${resolvedReaderTheme}`,
      `book-reader--${resolvedFlow}`,
    ]"
    :style="readerStyle"
    :theme="readerNaiveTheme"
    :theme-overrides="readerNaiveThemeOverrides"
  >
    <header
      v-if="controlsVisible"
      class="book-reader__app-bar"
      :class="{
        'book-reader__app-bar--with-translation':
          showsAutomaticTranslationControls,
      }"
    >
      <button
        class="book-reader__app-bar-action"
        type="button"
        aria-label="返回书籍详情"
        @click="openDetails"
      >
        <n-icon :component="ArrowBackOutlined" />
      </button>
      <div v-if="result?.kind === 'ready'" class="book-reader__app-bar-title">
        <span :title="result.book.title">{{ result.book.title }}</span>
      </div>
      <div v-else class="book-reader__app-bar-title">本地阅读器</div>
      <div
        v-if="showsAutomaticTranslationControls"
        class="book-reader__app-bar-translation"
      >
        <span>{{ currentTranslationStatusLabel }}</span>
        <n-button
          size="tiny"
          :type="
            ordinaryAutomaticTranslationSource === 'gpt' ? 'primary' : 'default'
          "
          :secondary="ordinaryAutomaticTranslationSource !== 'gpt'"
          :aria-pressed="ordinaryAutomaticTranslationSource === 'gpt'"
          @click="toggleAutomaticTranslation('gpt')"
        >
          GPT 自动翻译
        </n-button>
        <n-button
          size="tiny"
          :type="
            ordinaryAutomaticTranslationSource === 'sakura'
              ? 'primary'
              : 'default'
          "
          :secondary="ordinaryAutomaticTranslationSource !== 'sakura'"
          :aria-pressed="ordinaryAutomaticTranslationSource === 'sakura'"
          @click="toggleAutomaticTranslation('sakura')"
        >
          Sakura 自动翻译
        </n-button>
      </div>
      <button
        v-if="showsAutomaticTranslationControls"
        class="book-reader__app-bar-action book-reader__translation-toggle"
        type="button"
        :aria-label="
          showMobileTranslationNotice ? '收起未翻译操作' : '展开未翻译操作'
        "
        :aria-expanded="showMobileTranslationNotice"
        @click="showMobileTranslationNotice = !showMobileTranslationNotice"
      >
        <n-icon :component="WarningAmberOutlined" />
      </button>
      <button
        class="book-reader__app-bar-action"
        type="button"
        :aria-label="
          activeViewportBookmark === undefined
            ? '添加当前位置书签'
            : '取消当前位置书签'
        "
        :aria-pressed="activeViewportBookmark !== undefined"
        @click="toggleBookmark"
      >
        <n-icon
          :component="
            activeViewportBookmark === undefined
              ? BookmarkBorderOutlined
              : BookmarkOutlined
          "
        />
      </button>
    </header>

    <ReaderBottomSheet
      v-model:show="showMobileTranslationNotice"
      title="未翻译"
      placement="top"
    >
      <div class="book-reader__translation-panel">
        <div class="book-reader__translation-panel-actions">
          <n-button
            size="small"
            :type="
              ordinaryAutomaticTranslationSource === 'gpt'
                ? 'primary'
                : 'default'
            "
            :aria-pressed="ordinaryAutomaticTranslationSource === 'gpt'"
            @click="toggleAutomaticTranslation('gpt')"
          >
            GPT 自动翻译
          </n-button>
          <n-button
            size="small"
            :type="
              ordinaryAutomaticTranslationSource === 'sakura'
                ? 'primary'
                : 'default'
            "
            :aria-pressed="ordinaryAutomaticTranslationSource === 'sakura'"
            @click="toggleAutomaticTranslation('sakura')"
          >
            Sakura 自动翻译
          </n-button>
        </div>
      </div>
    </ReaderBottomSheet>

    <div
      v-if="result?.kind === 'ready' && !showMobileTranslationNotice"
      class="book-reader__status-bar book-reader__status-bar--top"
    >
      <span
        class="book-reader__corner-status book-reader__chapter-status"
        :title="displayReaderTitle(result.chapter)"
      >
        {{ displayReaderTitle(result.chapter) }}
      </span>
      <span class="book-reader__corner-status book-reader__time-status">
        {{ currentTime }}
      </span>
    </div>

    <div
      v-if="result?.kind === 'ready'"
      class="book-reader__status-bar book-reader__status-bar--bottom"
    >
      <span
        class="book-reader__corner-status book-reader__book-status"
        :title="result.book.title"
      >
        {{ result.book.title }}
      </span>
      <span
        class="book-reader__corner-status book-reader__reading-progress-status"
      >
        {{ Math.round(chapterProgressPercent) }}%
      </span>
    </div>

    <div
      v-if="loading"
      class="book-reader__loading"
      role="status"
      aria-live="polite"
    >
      <n-spin size="large" />
      <span>正在加载阅读内容…</span>
    </div>

    <n-result
      v-else-if="result?.kind === 'error'"
      status="error"
      title="无法打开书籍"
      :description="result.message"
    >
      <template #footer>
        <n-space justify="center">
          <n-button type="primary" @click="load">重试</n-button>
          <n-button @click="backHome">返回首页</n-button>
        </n-space>
      </template>
    </n-result>

    <template v-else-if="result?.kind === 'ready'">
      <article
        ref="readerViewport"
        class="book-reader__content"
        :class="[
          `book-reader__content--${resolvedFlow}`,
          {
            'book-reader__content--double-spread':
              resolvedFlow === 'paginated' && usesDoublePageSpread,
          },
        ]"
        :aria-label="
          resolvedFlow === 'paginated'
            ? `正文，第 ${readerPageIndex + 1} / ${readerPageCount} 页`
            : '正文'
        "
        tabindex="0"
        @click="toggleControlsFromContent"
        @scroll.passive="handleViewportScroll"
        @wheel="handleViewportWheel"
        @touchstart.passive="handleViewportTouchStart"
        @touchmove="handleViewportTouchMove"
        @touchend.passive="handleViewportTouchEnd"
        @touchcancel.passive="handleViewportTouchEnd"
      >
        <template v-if="resolvedFlow === 'scrolled'">
          <section
            v-for="preview in previousChapterPreviews"
            :key="`previous:${preview.chapter.chapterId}`"
            class="book-reader__continuous-chapter book-reader__chapter-preview"
            data-reader-chapter-preview="previous"
            :data-reader-preview-chapter-id="preview.chapter.chapterId"
            :data-reader-adjacent-preview="
              isScrolledChapterCheckpoint('previous', preview.summaryIndex)
                ? 'true'
                : undefined
            "
          >
            <ReaderEpubLayout
              v-if="preview.chapter.epub !== undefined"
              :epub="preview.chapter.epub"
              :segments="getPreviewSegments(preview)"
              :mode="getChapterRenderedMode(preview.chapter)"
              :flow="resolvedFlow"
              :book-id="bookId"
              :chinese-script="activeSettings.chineseScript"
              :convert-original="chineseScriptSides.original"
              :convert-translated="chineseScriptSides.translated"
              :layout-revision="`${activeSettings.fontSize}/${activeSettings.lineHeight}/${activeSettings.horizontalPadding}`"
              preview-direction="previous"
              @content-change="scheduleCurrentContinuousPreviewFill"
              @conversion-error="handleChineseScriptError"
              @link-activate="navigateToEpubHref"
            />
            <ReaderSegmentLayout
              v-else
              :segments="getPreviewSegments(preview)"
              :mode="getChapterRenderedMode(preview.chapter)"
              :flow="resolvedFlow"
              :book-id="bookId"
              :chinese-script="activeSettings.chineseScript"
              :convert-original="chineseScriptSides.original"
              :convert-translated="chineseScriptSides.translated"
              @conversion-error="handleChineseScriptError"
            />
          </section>
          <section
            v-for="chapter in continuousChapters"
            :key="chapter.chapterId"
            class="book-reader__continuous-chapter"
            :data-reader-chapter-id="chapter.chapterId"
          >
            <ReaderEpubLayout
              v-if="chapter.epub !== undefined"
              :epub="chapter.epub"
              :segments="chapter.segments"
              :mode="getChapterRenderedMode(chapter)"
              :flow="resolvedFlow"
              :book-id="bookId"
              :chinese-script="activeSettings.chineseScript"
              :convert-original="chineseScriptSides.original"
              :convert-translated="chineseScriptSides.translated"
              :double-spread="usesDoublePageSpread"
              :layout-revision="`${activeSettings.fontSize}/${activeSettings.lineHeight}/${activeSettings.horizontalPadding}`"
              @content-change="handleSegmentContentChange"
              @conversion-error="handleChineseScriptError"
              @link-activate="navigateToEpubHref"
            />
            <ReaderSegmentLayout
              v-else
              :segments="chapter.segments"
              :mode="getChapterRenderedMode(chapter)"
              :initial-segment-id="
                continuousChapterInitialSegments.get(chapter.chapterId)
              "
              :flow="resolvedFlow"
              :book-id="bookId"
              :chinese-script="activeSettings.chineseScript"
              :convert-original="chineseScriptSides.original"
              :convert-translated="chineseScriptSides.translated"
              continuous
              @content-change="handleSegmentContentChange"
              @conversion-error="handleChineseScriptError"
            />
          </section>
          <section
            v-for="preview in nextChapterPreviews"
            :key="`next:${preview.chapter.chapterId}`"
            class="book-reader__continuous-chapter book-reader__chapter-preview"
            data-reader-chapter-preview="next"
            :data-reader-preview-chapter-id="preview.chapter.chapterId"
            :data-reader-adjacent-preview="
              isScrolledChapterCheckpoint('next', preview.summaryIndex)
                ? 'true'
                : undefined
            "
          >
            <ReaderEpubLayout
              v-if="preview.chapter.epub !== undefined"
              :epub="preview.chapter.epub"
              :segments="getPreviewSegments(preview)"
              :mode="getChapterRenderedMode(preview.chapter)"
              :flow="resolvedFlow"
              :book-id="bookId"
              :chinese-script="activeSettings.chineseScript"
              :convert-original="chineseScriptSides.original"
              :convert-translated="chineseScriptSides.translated"
              :layout-revision="`${activeSettings.fontSize}/${activeSettings.lineHeight}/${activeSettings.horizontalPadding}`"
              preview-direction="next"
              @content-change="scheduleCurrentContinuousPreviewFill"
              @conversion-error="handleChineseScriptError"
              @link-activate="navigateToEpubHref"
            />
            <ReaderSegmentLayout
              v-else
              :segments="getPreviewSegments(preview)"
              :mode="getChapterRenderedMode(preview.chapter)"
              :flow="resolvedFlow"
              :book-id="bookId"
              :chinese-script="activeSettings.chineseScript"
              :convert-original="chineseScriptSides.original"
              :convert-translated="chineseScriptSides.translated"
              @conversion-error="handleChineseScriptError"
            />
          </section>
        </template>
        <ReaderEpubLayout
          v-else-if="result.chapter.epub !== undefined"
          :epub="result.chapter.epub"
          :segments="result.chapter.segments"
          :mode="renderedMode"
          :flow="resolvedFlow"
          :book-id="bookId"
          :chinese-script="activeSettings.chineseScript"
          :convert-original="chineseScriptSides.original"
          :convert-translated="chineseScriptSides.translated"
          :double-spread="usesDoublePageSpread"
          :layout-revision="`${activeSettings.fontSize}/${activeSettings.lineHeight}/${activeSettings.horizontalPadding}`"
          @content-change="handleSegmentContentChange"
          @conversion-error="handleChineseScriptError"
          @link-activate="navigateToEpubHref"
        />
        <ReaderSegmentLayout
          v-else
          ref="readerSegments"
          :segments="result.chapter.segments"
          :mode="renderedMode"
          :initial-segment-id="initialSegmentId"
          :flow="resolvedFlow"
          :book-id="bookId"
          :chinese-script="activeSettings.chineseScript"
          :convert-original="chineseScriptSides.original"
          :convert-translated="chineseScriptSides.translated"
          :scroll-root="readerViewport"
          @content-change="handleSegmentContentChange"
          @conversion-error="handleChineseScriptError"
        />
      </article>
    </template>

    <nav
      v-if="controlsVisible && result?.kind === 'ready' && !loading"
      class="book-reader__bottom-navigation"
      aria-label="阅读器导航"
    >
      <button
        class="book-reader__chapter-navigation"
        type="button"
        aria-label="上一章"
        :disabled="previousChapterId === undefined"
        @click="previousChapterId && navigate(previousChapterId, 'start')"
      >
        <n-icon :component="ChevronLeftOutlined" />
      </button>
      <div class="book-reader__bottom-actions">
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
        <button type="button" @click="openSettings">
          <n-icon :component="SettingsOutlined" />
          <span>设置</span>
        </button>
        <button type="button" @click="openTools">
          <n-icon :component="BuildOutlined" />
          <span>工具</span>
        </button>
        <button
          type="button"
          @pointerdown="captureInteractiveSelection"
          @click="openInteractiveTranslation"
        >
          <n-icon :component="AutoAwesomeOutlined" />
          <span>AI</span>
        </button>
      </div>
      <button
        class="book-reader__chapter-navigation"
        type="button"
        aria-label="下一章"
        :disabled="nextChapterId === undefined"
        @click="nextChapterId && navigate(nextChapterId, 'start')"
      >
        <n-icon :component="ChevronRightOutlined" />
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
          <div
            v-for="entry in visibleCatalogEntries"
            :key="entry.id"
            class="book-reader__catalog-row"
            :style="{ '--catalog-indent': `${entry.level * 22}px` }"
            role="listitem"
          >
            <button
              type="button"
              class="book-reader__catalog-item"
              :class="{
                'book-reader__catalog-item--active':
                  entry.chapterId === result.chapter.chapterId,
                'book-reader__catalog-item--structural':
                  entry.chapterId === undefined,
              }"
              :disabled="
                entry.chapterId === undefined && !catalogParentIds.has(entry.id)
              "
              :aria-expanded="
                catalogParentIds.has(entry.id)
                  ? !collapsedCatalogEntryIds.has(entry.id)
                  : undefined
              "
              @click="navigateFromCatalog(entry)"
            >
              <span
                class="book-reader__catalog-indicator"
                :class="{
                  'book-reader__catalog-indicator--expanded':
                    catalogParentIds.has(entry.id) &&
                    !collapsedCatalogEntryIds.has(entry.id),
                }"
                aria-hidden="true"
              >
                <n-icon
                  v-if="catalogParentIds.has(entry.id)"
                  :component="ChevronRightOutlined"
                />
              </span>
              <span class="book-reader__catalog-title">
                {{ displayReaderTitle(entry) }}
              </span>
              <n-tag
                v-if="
                  entry.chapterId !== undefined &&
                  requiresWholeChapterTranslation
                "
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
                    chapterSummaryById.get(entry.chapterId)
                      ?.translationStatus ?? 'none',
                  )
                }}
              </n-tag>
            </button>
          </div>
        </div>
      </template>
    </ReaderBottomSheet>

    <ReaderBottomSheet v-model:show="showTools" title="阅读工具" wide>
      <div class="book-reader__tool-grid">
        <n-button @click="openSearch">全文搜索</n-button>
        <n-button
          @click="
            showTools = false;
            showBookmarks = true;
          "
        >
          书签 ({{ bookmarks.length }})
        </n-button>
        <n-button
          :type="isSpeaking ? 'primary' : 'default'"
          @click="toggleCurrentSegmentSpeech"
        >
          朗读当前段
        </n-button>
        <n-button
          @click="
            showTools = false;
            showBookInfo = true;
          "
        >
          书籍信息
        </n-button>
        <n-button
          v-if="requiresWholeChapterTranslation"
          @click="openReaderGlossary"
        >
          术语表
        </n-button>
        <n-button
          v-if="requiresWholeChapterTranslation"
          :loading="clearingAutomaticTranslationCache"
          @click="clearReaderAutomaticTranslationCache"
        >
          清除翻译缓存
        </n-button>
        <n-button
          v-if="requiresWholeChapterTranslation"
          :type="isCurrentChapterRetranslating ? 'primary' : 'default'"
          :disabled="
            !isCurrentChapterRetranslating && !canRetranslateCurrentChapter
          "
          :aria-pressed="isCurrentChapterRetranslating"
          @click="toggleCurrentChapterRetranslation"
        >
          重新翻译
        </n-button>
        <n-button
          v-if="requiresWholeChapterTranslation"
          @click="refreshCurrentChapter"
        >
          刷新本页
        </n-button>
      </div>
    </ReaderBottomSheet>

    <ReaderBottomSheet
      v-model:show="showRetranslationSelection"
      title="重新翻译"
    >
      <p class="book-reader__retranslation-description">
        从当前章原文开始重新翻译；完成前只保存到阅读缓存，不会修改正式译文。
      </p>
      <n-form class="book-reader__retranslation-options" label-placement="top">
        <n-form-item label="范围" :show-feedback="false">
          <n-select
            v-model:value="retranslationScope"
            :options="retranslationScopeOptions"
          />
        </n-form-item>
        <n-form-item
          v-if="retranslationScope === 'continuous'"
          label="遇到未翻译章"
          :show-feedback="false"
        >
          <n-select
            v-model:value="retranslationUntranslatedPolicy"
            :options="retranslationUntranslatedPolicyOptions"
          />
        </n-form-item>
      </n-form>
      <div class="book-reader__retranslation-actions">
        <n-button
          :disabled="automaticGptWorkerOptions.length === 0"
          @click="startCurrentChapterRetranslation('gpt')"
        >
          GPT 自动翻译
        </n-button>
        <n-button
          :disabled="automaticSakuraWorkerOptions.length === 0"
          @click="startCurrentChapterRetranslation('sakura')"
        >
          Sakura 自动翻译
        </n-button>
      </div>
    </ReaderBottomSheet>

    <ReaderBottomSheet
      :show="showRetranslationDecision"
      title="重翻已完成"
      @update:show="
        (show) => {
          showRetranslationDecision = show;
          if (!show) applyRetranslationDecision(false);
        }
      "
    >
      <p class="book-reader__retranslation-description">
        当前章已完整重翻，是否用新结果替换现有译文？不替换原有翻译时，结果仍会保留在阅读缓存中。
      </p>
      <div class="book-reader__retranslation-actions">
        <n-button @click="applyRetranslationDecision(false)">
          不替换原有翻译
        </n-button>
        <n-button type="primary" @click="applyRetranslationDecision(true)">
          替换原有翻译
        </n-button>
      </div>
    </ReaderBottomSheet>

    <ReaderBottomSheet
      v-model:show="showReaderGlossary"
      title="术语表处理"
      wide
    >
      <div v-if="readerGlossaryLoading" class="book-reader__embedded-loading">
        <n-spin size="medium" />
        <span>正在读取术语表…</span>
      </div>
      <n-alert v-else-if="readerGlossaryError" type="error">
        加载失败：{{ readerGlossaryError }}
      </n-alert>
      <Suspense v-else>
        <ToolboxItemGlossary
          :key="readerGlossaryEditorRevision"
          :files="emptyReaderGlossaryFiles"
          :load-files="loadReaderGlossaryFiles"
          :initial-glossary="readerGlossaryInitial"
          :initial-candidate-counts="readerGlossaryInitialCandidateCounts"
          :initial-excluded-words="readerGlossaryInitialExcludedWords"
          :initial-minimum-count="10"
          auto-scan-if-empty
          :applying="readerGlossaryApplying"
          apply-label="应用到本书"
          @apply="applyReaderGlossary"
          @scan="saveReaderGlossaryCandidates"
        />
        <template #fallback>
          <div class="book-reader__embedded-loading">
            <n-spin size="medium" />
            <span>正在加载术语表工具…</span>
          </div>
        </template>
      </Suspense>
    </ReaderBottomSheet>

    <ReaderBottomSheet v-model:show="showBookInfo" title="书籍信息">
      <dl v-if="result?.kind === 'ready'" class="book-reader__book-info">
        <div>
          <dt>书名</dt>
          <dd>{{ result.book.title }}</dd>
        </div>
        <div>
          <dt>作者</dt>
          <dd>{{ result.book.author || '—' }}</dd>
        </div>
        <div>
          <dt>章节</dt>
          <dd>{{ result.book.chapterCount }} 章</dd>
        </div>
        <div>
          <dt>当前章节</dt>
          <dd>{{ displayReaderTitle(result.chapter) }}</dd>
        </div>
        <div>
          <dt>阅读进度</dt>
          <dd>{{ Math.round(chapterProgressPercent) }}%</dd>
        </div>
      </dl>
    </ReaderBottomSheet>

    <ReaderBottomSheet
      v-model:show="showInteractiveTranslation"
      title="AI 查词"
      wide
    >
      <Suspense>
        <InteractiveTranslation
          embedded
          :initial-text="interactiveInitialText"
        />
        <template #fallback>
          <div class="book-reader__embedded-loading">
            <n-spin size="medium" />
            <span>正在加载查词工具…</span>
          </div>
        </template>
      </Suspense>
    </ReaderBottomSheet>

    <ReaderBottomSheet v-model:show="showSearch" title="全文搜索" wide>
      <n-input-group>
        <n-input
          v-model:value="searchQuery"
          clearable
          placeholder="搜索原文和译文"
          @keyup.enter="runSearch"
        />
        <n-button
          type="primary"
          :loading="searchLoading"
          :disabled="searchQuery.trim().length === 0"
          @click="runSearch"
        >
          搜索
        </n-button>
      </n-input-group>
      <n-alert
        v-if="searchTruncated"
        type="info"
        role="status"
        style="margin-top: 12px"
      >
        已达到搜索上限，仅显示前 200 条
      </n-alert>
      <n-empty
        v-if="searchResults.length === 0 && !searchLoading"
        :description="
          searchQuery.trim() ? '没有匹配内容' : '输入关键词开始搜索'
        "
        style="margin-top: 20px"
      />
      <n-list v-else hoverable clickable style="margin-top: 12px">
        <n-list-item
          v-for="searchResult in searchResults"
          :key="`${searchResult.chapterId}/${searchResult.segmentId}/${searchResult.languageSide}`"
          @click="openSearchResult(searchResult)"
        >
          <n-thing
            :title="searchResult.chapterTitle"
            :description="searchResult.excerpt"
          >
            <template #header-extra>
              <n-tag size="small">
                {{ searchResult.languageSide === 'original' ? '原文' : '译文' }}
              </n-tag>
            </template>
          </n-thing>
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

    <ReaderBottomSheet v-model:show="showSettings" title="阅读设置" wide>
      <n-form label-placement="top" class="book-reader__settings-grid">
        <div class="book-reader__settings-half">
          <n-form-item label="字体大小">
            <n-slider v-model:value="settings.fontSize" :max="32" :min="12" />
          </n-form-item>
        </div>
        <div class="book-reader__settings-half">
          <n-form-item label="行高">
            <n-slider
              v-model:value="settings.lineHeight"
              :max="2.8"
              :min="1.2"
              :step="0.1"
            />
          </n-form-item>
        </div>
        <div class="book-reader__settings-half">
          <n-form-item label="正文宽度">
            <n-slider
              v-model:value="settings.contentWidth"
              :max="1200"
              :min="480"
              :step="20"
            />
          </n-form-item>
        </div>
        <div class="book-reader__settings-half">
          <n-form-item label="页面边距">
            <n-slider
              v-model:value="settings.horizontalPadding"
              :max="64"
              :min="12"
              :step="2"
            />
          </n-form-item>
        </div>
        <div class="book-reader__settings-half">
          <n-form-item label="主题">
            <n-select
              v-model:value="settings.theme"
              :options="[
                { label: '跟随系统', value: 'system' },
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' },
                { label: '超暗', value: 'ultra-dark' },
                { label: '护眼', value: 'sepia' },
              ]"
            />
          </n-form-item>
        </div>
        <div class="book-reader__settings-half">
          <n-form-item label="阅读流">
            <n-select
              v-model:value="settings.flow"
              :options="readerFlowOptions"
            />
          </n-form-item>
        </div>
        <div
          v-if="requiresWholeChapterTranslation"
          class="book-reader__settings-reading-language"
        >
          <n-form-item>
            <template #label>
              <span class="book-reader__settings-reading-label">
                <span>阅读语言</span>
                <n-text v-if="currentChapterAwaitsTranslation" type="warning">
                  翻译后生效
                </n-text>
              </span>
            </template>
            <n-select
              :value="readingMode"
              :options="readerModeOptions"
              @update:value="chooseSettingsMode"
            />
          </n-form-item>
        </div>
        <div
          v-if="requiresWholeChapterTranslation"
          class="book-reader__settings-quarter"
        >
          <n-form-item>
            <template #label>
              <span class="book-reader__settings-label">
                自动翻译预翻译页数
                <n-popover
                  v-if="isDesktopReader"
                  trigger="click"
                  placement="bottom-start"
                  :style="{
                    maxWidth: 'min(320px, calc(100vw - 32px))',
                    whiteSpace: 'normal',
                  }"
                >
                  <template #trigger>
                    <button
                      class="book-reader__settings-info"
                      type="button"
                      aria-label="自动翻译预翻译说明"
                    >
                      <n-icon :component="InfoOutlined" />
                    </button>
                  </template>
                  提前翻译当前页之后的页数；0 表示只处理当前可见页。
                </n-popover>
                <button
                  v-else
                  class="book-reader__settings-info"
                  type="button"
                  aria-label="自动翻译预翻译说明"
                  :aria-expanded="showMobilePreloadHelp"
                  @click.stop="showMobilePreloadHelp = !showMobilePreloadHelp"
                >
                  <n-icon :component="InfoOutlined" />
                </button>
              </span>
            </template>
            <n-input-number
              :value="settings.autoTranslationPreloadParagraphs"
              :min="0"
              :max="20"
              :precision="0"
              :input-props="{
                'aria-label': '自动翻译预翻译页数',
              }"
              @update:value="updateAutoTranslationPreloadPages"
            />
          </n-form-item>
        </div>
        <div
          v-if="requiresWholeChapterTranslation"
          class="book-reader__settings-quarter"
        >
          <n-form-item label="重翻完成后">
            <n-select
              v-model:value="settings.retranslationPolicy"
              :options="[
                { label: '询问', value: 'ask' },
                { label: '替换原有翻译', value: 'replace' },
                { label: '不替换原有翻译', value: 'keep' },
              ]"
            />
          </n-form-item>
        </div>
        <div
          v-if="requiresWholeChapterTranslation"
          class="book-reader__settings-translator"
        >
          <n-form-item label="GPT 翻译器">
            <n-select
              v-model:value="automaticGptWorkerValue"
              :options="automaticGptWorkerOptions"
              :disabled="automaticGptWorkerOptions.length === 0"
              placeholder="尚未配置 GPT 翻译器"
            />
          </n-form-item>
        </div>
        <div
          v-if="requiresWholeChapterTranslation"
          class="book-reader__settings-translator"
        >
          <n-form-item label="Sakura 翻译器">
            <n-select
              v-model:value="automaticSakuraWorkerValue"
              :options="automaticSakuraWorkerOptions"
              :disabled="automaticSakuraWorkerOptions.length === 0"
              placeholder="尚未配置 Sakura 翻译器"
            />
          </n-form-item>
        </div>
      </n-form>
    </ReaderBottomSheet>

    <div
      v-if="showSettings && showMobilePreloadHelp && !isDesktopReader"
      class="book-reader__mobile-preload-help"
      role="tooltip"
    >
      提前翻译当前页之后的页数；0 表示只处理当前可见页。
    </div>
  </n-config-provider>
</template>

<style scoped>
.book-reader {
  --reader-app-bar-height: 40px;
  --reader-bottom-navigation-height: 52px;
  --reader-progress-track: rgb(127 127 127 / 20%);
  --reader-progress-color: #5bd6b0;
  width: 100%;
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100dvh;
  padding-top: 24px;
  padding-bottom: 8px;
  overflow-x: hidden;
  color: var(--reader-text-color, var(--n-text-color));
  background: var(--reader-background, transparent);
}

.book-reader--light {
  --reader-text-color: #353535;
  --reader-muted-color: #777;
  --reader-background: #fafafa;
  --reader-chrome-background: #f1f1f1;
  --reader-chrome-border: rgb(0 0 0 / 12%);
  --reader-warning-background: #f7dfa0;
  --reader-warning-border: #c88710;
  --reader-warning-button-border: #f0a020;
  --reader-warning-text: #5b4300;
  --reader-scrollbar-track: #f1f1f1;
  --reader-scrollbar-thumb: #aaa;
  --reader-scrollbar-thumb-hover: #888;
}

.book-reader--dark {
  --reader-text-color: #c9c9c9;
  --reader-muted-color: #929292;
  --reader-background: #191919;
  --reader-chrome-background: #242424;
  --reader-chrome-border: rgb(255 255 255 / 8%);
  --reader-warning-background: #302b27;
  --reader-warning-border: #9e6a27;
  --reader-warning-button-border: #8b7864;
  --reader-warning-text: #f2e8dc;
  --reader-scrollbar-track: #242424;
  --reader-scrollbar-thumb: #626262;
  --reader-scrollbar-thumb-hover: #7a7a7a;
}

.book-reader--ultra-dark {
  --reader-text-color: #4b4b4b;
  --reader-muted-color: #3d3d3d;
  --reader-background: #000;
  --reader-chrome-background: #050505;
  --reader-chrome-border: rgb(255 255 255 / 6%);
  --reader-warning-background: #060504;
  --reader-warning-border: #211a12;
  --reader-warning-button-border: #282018;
  --reader-warning-text: #40382f;
  --reader-scrollbar-track: #050505;
  --reader-scrollbar-thumb: #202020;
  --reader-scrollbar-thumb-hover: #2b2b2b;
  --reader-progress-track: #0c0c0c;
  --reader-progress-color: #25493f;
}

.book-reader--sepia {
  --reader-text-color: #4a3925;
  --reader-muted-color: #806f58;
  --reader-background: #f4ecd8;
  --reader-chrome-background: #e8ddc3;
  --reader-chrome-border: rgb(74 57 37 / 14%);
  --reader-warning-background: #f4d998;
  --reader-warning-border: #b57b20;
  --reader-warning-button-border: #6f511c;
  --reader-warning-text: #543b0b;
  --reader-scrollbar-track: #e8ddc3;
  --reader-scrollbar-thumb: #a08e6d;
  --reader-scrollbar-thumb-hover: #806f58;
}

.book-reader--paginated {
  height: 100dvh;
  min-height: 0;
  overflow-y: hidden;
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

.book-reader__app-bar-action :deep(.n-icon) {
  font-size: 24px;
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

.book-reader__app-bar--with-translation .book-reader__app-bar-title {
  max-width: calc(50vw - 410px);
}

.book-reader__app-bar-translation {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  max-width: calc(100vw - 520px);
  overflow: hidden;
  color: var(--reader-warning-text);
  white-space: nowrap;
  transform: translate(-50%, -50%);
  gap: 8px;
}

.book-reader__app-bar-translation > span::before {
  margin-right: 5px;
  content: '⚠';
}

.book-reader__translation-toggle {
  display: none;
  color: var(--reader-warning-text);
}

.book-reader__corner-status {
  overflow: hidden;
  color: var(--reader-muted-color);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.book-reader__status-bar {
  position: fixed;
  right: 0;
  left: 0;
  z-index: 20;
  display: flex;
  box-sizing: border-box;
  height: 24px;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  pointer-events: none;
  gap: 16px;
}

.book-reader--scrolled .book-reader__status-bar {
  background: var(--reader-background);
}

.book-reader__status-bar--top {
  top: 0;
}

.book-reader__status-bar--bottom {
  bottom: 0;
}

.book-reader__chapter-status,
.book-reader__book-status {
  min-width: 0;
  max-width: calc(100vw - 96px);
}

.book-reader__time-status,
.book-reader__reading-progress-status {
  flex: 0 0 auto;
}

.book-reader__translation-panel {
  display: grid;
  width: 100%;
  color: var(--reader-warning-text);
  text-align: center;
  gap: 12px;
}

.book-reader__translation-panel-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.book-reader--sepia .book-reader__catalog-item--active {
  color: #2faf86 !important;
}

.book-reader--ultra-dark .book-reader__catalog-item--active {
  color: #356f5e !important;
  background: rgb(53 111 94 / 10%) !important;
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
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  min-height: 48px;
  padding: 8px;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--reader-chrome-border);
  gap: 12px;
}

.book-reader__catalog-row {
  padding-left: var(--catalog-indent);
  border-bottom: 1px solid var(--reader-chrome-border);
}

.book-reader__catalog-row .book-reader__catalog-item {
  border-bottom: 0;
}

.book-reader__catalog-indicator {
  display: grid;
  width: 28px;
  place-items: center;
  color: var(--reader-muted-color);
}

.book-reader__catalog-indicator :deep(.n-icon) {
  transition: transform 160ms ease;
}

.book-reader__catalog-indicator--expanded :deep(.n-icon) {
  transform: rotate(90deg);
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
  opacity: 1;
}

.book-reader__catalog-item:disabled {
  cursor: default;
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

.book-reader__retranslation-description {
  margin: 0 0 16px;
  color: var(--reader-muted-color);
  line-height: 1.7;
}

.book-reader__retranslation-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 16px;
  gap: 20px;
}

.book-reader__retranslation-options :deep(.n-form-item) {
  min-width: 0;
}

@media (max-width: 639px) {
  .book-reader__retranslation-options {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
}

.book-reader__retranslation-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.book-reader__book-info {
  display: grid;
  margin: 0;
  gap: 10px;
}

.book-reader__book-info > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
}

.book-reader__book-info dt {
  color: var(--reader-muted-color);
}

.book-reader__book-info dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.book-reader__embedded-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  gap: 10px;
  color: var(--reader-muted-color);
}

.book-reader__settings-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0 32px;
}

.book-reader__settings-half,
.book-reader__settings-reading-language,
.book-reader__settings-translator {
  grid-column: span 2;
}

.book-reader__settings-quarter {
  grid-column: span 1;
}

.book-reader__settings-label,
.book-reader__settings-reading-label {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 4px;
}

.book-reader__settings-reading-label {
  width: 100%;
  justify-content: space-between;
  gap: 16px;
}

.book-reader__settings-reading-language :deep(.n-form-item-label) {
  align-self: stretch;
  width: 100%;
}

.book-reader__settings-reading-language :deep(.n-form-item-label__text) {
  display: block;
  width: 100%;
}

.book-reader__settings-info {
  display: inline-grid;
  width: 20px;
  height: 20px;
  padding: 0;
  place-items: center;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border: 0;
  background: transparent;
}

.book-reader__settings-info :deep(.n-icon) {
  font-size: 18px;
}

.book-reader__mobile-preload-help {
  position: fixed;
  top: calc(var(--reader-app-bar-height) + 12px);
  right: 16px;
  left: 16px;
  z-index: 3000;
  max-width: 420px;
  padding: 10px 12px;
  margin: 0 auto;
  color: var(--reader-text-color);
  line-height: 1.5;
  background: var(--reader-chrome-background);
  border: 1px solid var(--reader-chrome-border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 30%);
  pointer-events: none;
}

.book-reader__loading {
  display: grid;
  min-height: calc(100dvh - 100px);
  align-content: center;
  place-items: center;
  gap: 12px;
}

.book-reader__content {
  box-sizing: border-box;
  font-size: var(--reader-font-size);
  line-height: var(--reader-line-height);
  outline: none;
}

.book-reader__content--scrolled {
  width: min(100%, var(--reader-content-width));
  margin: 0 auto;
  padding: 24px max(28px, var(--reader-padding)) 36px;
  overflow-anchor: none;
}

.book-reader__continuous-chapter + .book-reader__continuous-chapter {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--reader-chrome-border);
}

.book-reader__content--paginated {
  --reader-page-padding: max(
    28px,
    var(--reader-padding),
    calc((100vw - var(--reader-content-width)) / 2)
  );
  width: 100%;
  height: calc(100dvh - 32px);
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  overflow-y: hidden;
  overflow-anchor: none;
  overscroll-behavior: contain;
  position: relative;
  scroll-behavior: auto;
  scrollbar-width: none;
}

.book-reader__content--paginated::after {
  position: absolute;
  top: 0;
  left: var(--reader-page-tail-start, 100%);
  width: var(--reader-page-tail-space, 0);
  height: 1px;
  pointer-events: none;
  content: '';
}

.book-reader__content--paginated::-webkit-scrollbar {
  display: none;
}

.book-reader__content--paginated :deep(.reader-segment-layout) {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 44px var(--reader-page-padding) 24px;
  column-count: 1;
  column-gap: calc(var(--reader-page-padding) * 2);
  column-fill: auto;
}

.book-reader__content--paginated.book-reader__content--double-spread
  :deep(.reader-segment-layout) {
  column-count: 2;
}

.book-reader__content--paginated.book-reader__content--double-spread {
  --reader-page-padding: max(
    28px,
    var(--reader-padding),
    calc((50vw - var(--reader-content-width)) / 2)
  );
}

.book-reader__content p {
  scroll-margin-top: calc(var(--reader-app-bar-height) + 12px);
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.book-reader__bottom-navigation {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 52px;
  height: var(--reader-bottom-navigation-height);
  color: inherit;
  background: var(--reader-chrome-background, var(--reader-background));
  border-top: 1px solid var(--reader-chrome-border);
  box-shadow: 0 -2px 8px rgb(0 0 0 / 14%);
}

.book-reader__bottom-actions {
  display: flex;
  min-width: 0;
  height: 100%;
  justify-content: center;
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

.book-reader__bottom-navigation .book-reader__chapter-navigation {
  width: 100%;
  min-width: 0;
  padding: 0;
}

.book-reader__bottom-navigation .book-reader__chapter-navigation:disabled {
  color: var(--reader-muted-color);
  cursor: default;
  opacity: 0.38;
}

.book-reader__bottom-navigation
  .book-reader__chapter-navigation
  :deep(.n-icon) {
  font-size: 34px;
}

.book-reader__progress-track {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  height: 3px;
  overflow: hidden;
  background: var(--reader-progress-track);
}

.book-reader__progress-track span {
  display: block;
  height: 100%;
  background: var(--reader-progress-color);
  transition: width 180ms ease;
}

@media only screen and (max-width: 600px) {
  .book-reader {
    --reader-app-bar-height: 56px;
    --reader-bottom-navigation-height: 76px;
    padding-top: 26px;
  }

  .book-reader__app-bar {
    grid-template-columns: 56px minmax(0, 1fr) 56px;
  }

  .book-reader__app-bar--with-translation {
    grid-template-columns: 56px minmax(0, 1fr) 48px 56px;
  }

  .book-reader__app-bar-action :deep(.n-icon) {
    font-size: 28px;
  }

  .book-reader__app-bar-title {
    font-size: 17px;
  }

  .book-reader__app-bar--with-translation .book-reader__app-bar-title {
    max-width: none;
  }

  .book-reader__app-bar-translation {
    display: none;
  }

  .book-reader__translation-toggle {
    display: grid;
  }

  .book-reader__status-bar {
    height: 26px;
    padding: 4px 14px;
  }

  .book-reader__chapter-status {
    font-size: 12px;
  }

  .book-reader__book-status {
    max-width: calc(65vw - 20px);
  }

  .book-reader__content {
    padding: 18px max(22px, env(safe-area-inset-left)) 36px;
    font-size: var(--reader-font-size);
    line-height: var(--reader-line-height);
  }

  .book-reader__content--paginated {
    --reader-page-padding: max(
      22px,
      var(--reader-padding),
      env(safe-area-inset-left),
      env(safe-area-inset-right)
    );
    height: calc(100dvh - 34px);
    padding: 0;
  }

  .book-reader__content--paginated :deep(.reader-segment-layout) {
    padding: 46px var(--reader-page-padding) 18px;
    column-count: 1;
    column-gap: calc(var(--reader-page-padding) * 2);
  }

  .book-reader__bottom-actions button {
    width: 20%;
    min-width: 0;
    padding-bottom: max(5px, env(safe-area-inset-bottom));
  }

  .book-reader__bottom-navigation {
    grid-template-columns: 44px minmax(0, 1fr) 44px;
  }

  .book-reader__bottom-navigation .book-reader__chapter-navigation {
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

  .book-reader__settings-half,
  .book-reader__settings-quarter {
    grid-column: span 1;
  }

  .book-reader__settings-reading-language,
  .book-reader__settings-translator {
    grid-column: 1 / -1;
  }
}
</style>
