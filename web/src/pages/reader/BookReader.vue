<script lang="ts" setup>
import {
  ArrowBackOutlined,
  AutoAwesomeOutlined,
  BookmarkBorderOutlined,
  BookmarkOutlined,
  BuildOutlined,
  ChevronRightOutlined,
  DarkModeOutlined,
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
import {
  normalizeTranslationConcurrency,
  TranslateJob,
  TranslateTaskDescriptor,
} from '@/model/Translator';
import type { GptWorker, SakuraWorker } from '@/model/Translator';
import { Translator } from '@/domain/translate';
import type { TranslatorConfig } from '@/domain/translate';
import { useMediaQuery, useThrottleFn } from '@vueuse/core';
import { darkTheme, lightTheme } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import { useRouter } from 'vue-router';

import ReaderBottomSheet from './components/ReaderBottomSheet.vue';
import ReaderEpubLayout from './components/ReaderEpubLayout.vue';
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
  getReaderModeShortcut,
  readerModes,
  resolveReaderMode,
} from './core/ReaderMode';
import { getTranslationStatusLabel } from './core/ReaderTranslationWorkflow';
import {
  planReaderAutomaticTranslationWindow,
  ReaderAutomaticTranslationSession,
  resolveReaderAutomaticTranslationWorker,
  type ReaderAutomaticTranslationSelection,
  type ReaderAutomaticTranslationSource,
} from './core/ReaderAutoTranslation';
import { ReaderAutomaticTranslationCoordinator } from './core/ReaderAutomaticTranslationCoordinator';
import {
  applyReaderStyleOverride,
  defaultReaderSettings,
  normalizeReaderSettings,
  serializeReaderSettings,
} from './core/ReaderSettings';

import {
  useGptWorkspaceStore,
  useLocalVolumeStore,
  useSakuraWorkspaceStore,
} from '@/stores';

const InteractiveTranslation = defineAsyncComponent(
  () => import('../workspace/Interactive.vue'),
);

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const result = shallowRef<ReaderPageLoadResult>();
const initialSegmentId = ref<string>();
const showSettings = ref(false);
const showModePrompt = ref(false);
const showCatalog = ref(false);
const collapsedCatalogEntryIds = ref(new Set<string>());
const showTools = ref(false);
const showBookInfo = ref(false);
const showBookmarks = ref(false);
const showSearch = ref(false);
const showInteractiveTranslation = ref(false);
const showAutomaticTranslatorSelection = ref(false);
const interactiveInitialText = ref<string>();
const searchQuery = ref('');
const searchResults = shallowRef<ReaderSearchResult[]>([]);
const searchLoading = ref(false);
const searchTruncated = ref(false);
let searchUiRequestId = 0;
const showMobileTranslationNotice = ref(false);
const controlsVisible = ref(true);
const readerViewport = ref<HTMLElement | null>(null);
const readerSegments = ref<InstanceType<typeof ReaderSegmentLayout>>();
const readerPageCount = ref(1);
const readerPageIndex = ref(0);
const viewportProgressRatio = ref(0);
let paginatedAnchorSegmentId: string | undefined;
let viewportResizeFrame: number | undefined;
const isDesktopReader = useMediaQuery('(min-width: 768px)');
const usesDoublePageSpread = useMediaQuery('(min-width: 916px)');
const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
const bookmarks = ref<ReaderBookmark[]>([]);
const viewportChapterId = ref<string>();
const viewportSegmentId = ref<string>();
let pendingBookmark: ReaderBookmark | undefined;
const rememberModeChoice = ref(false);
const readingMode = ref<ReaderMode>('original');
const availableModes = ref<ReaderMode[]>(['original']);
const visiblePageModes = ref<ReaderMode[]>(['original']);
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
const continuousChapterLoads = new Set<string>();
const continuousChapterInitialSegments = new Map<string, string | undefined>();
let continuousLoadGeneration = 0;
let routeSyncedFromScroll: string | undefined;
let adjustingContinuousChapters = false;
const isSpeaking = ref(false);
const automaticTranslationSource = ref<ReaderAutomaticTranslationSource>();
const selectedAutomaticGptWorkerId = ref<string>();
const selectedAutomaticSakuraWorkerId = ref<string>();
const automaticTranslationSession = new ReaderAutomaticTranslationSession();
let automaticTranslationController: AbortController | undefined;
let automaticTranslationTimer: number | undefined;
let automaticTranslationRunning = false;
let automaticTranslationQueued = false;
const temporaryTranslations = new Map<string, string>();

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
    return translated === undefined ? segment : { ...segment, translated };
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
const hasIncompleteChapter = computed(
  () =>
    requiresWholeChapterTranslation.value &&
    currentChapterSummary.value !== undefined &&
    currentChapterSummary.value.translationStatus !== 'complete',
);
const hasIncompleteBookTranslation = computed(
  () =>
    requiresWholeChapterTranslation.value &&
    result.value?.kind === 'ready' &&
    result.value.chapters.some(
      ({ translationStatus }) => translationStatus !== 'complete',
    ),
);
const showsAutomaticTranslationControls = computed(
  () =>
    hasIncompleteChapter.value ||
    automaticTranslationSource.value !== undefined,
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
const currentTranslationStatusLabel = computed(() =>
  currentChapterSummary.value === undefined
    ? ''
    : getTranslationStatusLabel(currentChapterSummary.value.translationStatus),
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
  showAutomaticTranslatorSelection.value ||
  showModePrompt.value ||
  showMobileTranslationNotice.value;

const closeReaderPanels = () => {
  showCatalog.value = false;
  showSettings.value = false;
  showTools.value = false;
  showBookInfo.value = false;
  showBookmarks.value = false;
  showSearch.value = false;
  showInteractiveTranslation.value = false;
  showAutomaticTranslatorSelection.value = false;
  showModePrompt.value = false;
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
  showSettings.value = shouldOpen;
};

const openTools = () => {
  const shouldOpen = !showTools.value;
  closeReaderPanels();
  showTools.value = shouldOpen;
};

const openAutomaticTranslatorSelection = () => {
  showTools.value = false;
  showAutomaticTranslatorSelection.value = true;
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
    const readableDistance = Math.max(1, rect.height - window.innerHeight);
    viewportProgressRatio.value = Math.max(
      0,
      Math.min(1, -rect.top / readableDistance),
    );
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

const handleViewportScroll = () => {
  if (resolvedFlow.value === 'scrolled') {
    syncActiveContinuousChapter();
    void loadContinuousChaptersNearViewport();
  }
  updateViewportMetrics();
  saveProgressThrottled();
};

const handleViewportResize = () => {
  if (viewportResizeFrame !== undefined) {
    cancelAnimationFrame(viewportResizeFrame);
  }
  viewportResizeFrame = requestAnimationFrame(() => {
    viewportResizeFrame = undefined;
    if (resolvedFlow.value !== 'paginated') {
      updateViewportMetrics();
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
  const requestId = ++loadUiRequestId;
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
    initialSegmentId.value = targetSegment?.id;
    initializeContinuousChapters(loaded.chapter);
    result.value = loaded;
    pendingChapterEdge = undefined;
    loading.value = false;
    await scrollToChapterEdge(chapterEdge);
    updateViewportMetrics();
    void loadContinuousChaptersNearViewport();
    startReadingTime(loaded.book.id);
    return;
  }
  if (loaded.kind === 'ready') {
    await Promise.all([resolveMode(loaded), loadBookmarks(loaded.book.id)]);
    enableTemporaryReadingModes(loaded.chapter);
    if (requestId !== loadUiRequestId) return;
    initializeContinuousChapters(loaded.chapter);
    result.value = loaded;
    loading.value = false;
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
      initialSegmentId.value = targetSegment?.id;
      await scrollToChapterEdge(chapterEdge);
    } else if (requestedSegmentId.value !== undefined) {
      await nextTick();
      scrollToSegment(requestedSegmentId.value);
    }
    await nextTick();
    updateViewportMetrics();
    void loadContinuousChaptersNearViewport();
    startReadingTime(loaded.book.id);
    return;
  }
  continuousLoadGeneration += 1;
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
    showModePrompt.value = false;
    return;
  }
  availableModes.value = getAvailableReaderModes(capabilities);
  readingMode.value = resolveReaderMode({
    temporaryMode,
    preference,
    settings: normalizeReaderSettings(await repository.getReaderSettings()),
    capabilities,
  });
  bookStyle.value = preference?.style;
  showModePrompt.value = false;
};

const chooseMode = async (mode: ReaderMode) => {
  const anchor = captureReaderPosition();
  temporaryMode = mode;
  readingMode.value = mode;
  showModePrompt.value = false;
  await nextTick();
  await nextTick();
  restoreReaderPosition(anchor);
  updateViewportMetrics();
  await saveProgress();
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
  const candidates = getSegmentElements().flatMap((segment) =>
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
  const first = visible[0];
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
  const matchingSegments = getSegmentElements().filter(
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
    window.scrollTo({
      top: edge === 'start' ? 0 : document.documentElement.scrollHeight,
      behavior: 'auto',
    });
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
  if (
    requestedEpubHref.value !== undefined &&
    scrollToEpubHref(requestedEpubHref.value)
  ) {
    updateViewportMetrics();
    return;
  }
  if (anchorId !== undefined && resolvedFlow.value !== 'paginated') {
    scrollToSegment(anchorId);
  }
  updateViewportMetrics();
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
  const text = window.getSelection()?.toString().trim() ?? '';
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
    [ready.chapter, ...continuousChapters.value].map((chapter) => [
      chapter.chapterId,
      chapter,
    ]),
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
    const chapterId =
      element.closest<HTMLElement>('[data-reader-chapter-id]')?.dataset
        .readerChapterId ??
      (root instanceof ShadowRoot
        ? root.host.closest<HTMLElement>('[data-reader-chapter-id]')?.dataset
            .readerChapterId
        : undefined) ??
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

const openVisiblePageModePrompt = () => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return;
  const chapters = new Map(
    [ready.chapter, ...continuousChapters.value].map((chapter) => [
      chapter.chapterId,
      chapter,
    ]),
  );
  const hasVisibleTranslation = getVisibleReaderSegments().some((target) =>
    chapters
      .get(target.chapterId)
      ?.segments.some(
        (segment) =>
          segment.id === target.segmentId &&
          (segment.translated?.trim().length ?? 0) > 0,
      ),
  );
  visiblePageModes.value = hasVisibleTranslation
    ? [...readerModes]
    : ['original'];
  showModePrompt.value = true;
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
};

let activeAutomaticTranslationRuntime:
  ActiveAutomaticTranslationRuntime | undefined;

const loadedReaderChapters = () => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return [];
  return [
    ...new Map(
      [ready.chapter, ...continuousChapters.value].map((chapter) => [
        chapter.chapterId,
        chapter,
      ]),
    ).values(),
  ].sort((left, right) => left.chapterIndex - right.chapterIndex);
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

const markAutomaticTranslationCommitted = async (
  selection: ReaderAutomaticTranslationSelection,
  chapterId: string,
) => {
  if (!automaticTranslationSession.isActive(selection)) return;
  const adapter = await cachedAdapterPromise;
  adapter.invalidateChapter({ bookId: bookId.value, chapterId });
  const ready = result.value;
  if (ready?.kind !== 'ready') return;
  const chapters = ready.chapters.map((chapter) =>
    chapter.id === chapterId
      ? {
          ...chapter,
          translationStatus: 'complete' as const,
          translatedSegmentCount: chapter.totalSegmentCount,
          translationSources: [
            ...new Set([...chapter.translationSources, selection.source]),
          ],
        }
      : chapter,
  );
  result.value = {
    ...ready,
    chapters,
  };
  if (
    chapters.every(({ translationStatus }) => translationStatus === 'complete')
  ) {
    stopAutomaticTranslation(false);
    message.success('全书翻译已完成');
  }
};

const collectAutomaticTranslationChapters = async (
  visible: VisibleReaderSegment[],
) => {
  const ready = result.value;
  if (ready?.kind !== 'ready') return [];
  const chapters = new Map(
    loadedReaderChapters().map((chapter) => [chapter.chapterId, chapter]),
  );
  const visibleIndexes = visible.flatMap(({ chapterId }) => {
    const index = chapters.get(chapterId)?.chapterIndex;
    return index === undefined ? [] : [index];
  });
  if (visibleIndexes.length === 0) return [...chapters.values()];
  let nextIndex = Math.max(...visibleIndexes) + 1;
  const adapter = await cachedAdapterPromise;
  while (true) {
    const planned = planReaderAutomaticTranslationWindow({
      chapters: [...chapters.values()],
      visible,
      preloadPages: settings.value.autoTranslationPreloadPages,
    });
    const prefetchedCharacters = planned.prefetch.reduce(
      (total, target) => total + target.original.trim().length,
      0,
    );
    if (
      prefetchedCharacters >= planned.prefetchCharacterBudget ||
      nextIndex >= ready.chapters.length
    ) {
      break;
    }
    const summary = ready.chapters[nextIndex];
    nextIndex += 1;
    if (summary === undefined || chapters.has(summary.id)) continue;
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
  const visible = getVisibleReaderSegments();
  if (visible.length === 0) return;
  const chapters = await collectAutomaticTranslationChapters(visible);
  if (controller.signal.aborted) return;
  const planned = planReaderAutomaticTranslationWindow({
    chapters,
    visible,
    preloadPages: settings.value.autoTranslationPreloadPages,
  });
  if (planned.all.length === 0) return;
  const repository = await repositoryPromise;
  const coordinator = new ReaderAutomaticTranslationCoordinator(
    automaticTranslationSession,
    {
      loadChapter: (chapterId) =>
        repository.getChapter(bookId.value, chapterId),
      translate: async (selection, originals, glossary, signal) => {
        if (!automaticTranslationSession.isActive(selection)) return [];
        const translator = await Translator.create(runtime.config, false);
        return translator.translate(
          originals,
          { force: true, glossary, signal },
          {
            concurrency: selection.source === 'gpt' ? runtime.concurrency : 1,
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
      onDraft: showAutomaticTranslationDraft,
      onCommitted: (selection, chapterId) => {
        void markAutomaticTranslationCommitted(selection, chapterId);
      },
    },
  );
  await coordinator.translateTargets({
    generation: automaticTranslationSession.currentGeneration(),
    selection: runtime.selection,
    targets: planned.all,
    glossary: runtime.glossary,
    concurrency:
      runtime.selection.source === 'sakura' ? runtime.concurrency : 1,
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
      await runAutomaticTranslationOnce();
    } while (
      automaticTranslationQueued &&
      automaticTranslationController?.signal.aborted === false
    );
  } catch (reason) {
    if (automaticTranslationController?.signal.aborted === false) {
      message.error(`自动翻译失败：${String(reason)}`);
    }
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

const stopAutomaticTranslation = (notify = true) => {
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
  if (notify) message.info('已停止自动翻译');
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

const startAutomaticTranslation = async (
  source: ReaderAutomaticTranslationSource,
  notify = true,
) => {
  const worker = resolveConfiguredAutomaticTranslationWorker(source);
  if (worker === undefined) {
    stopAutomaticTranslation(false);
    message.warning(
      `请先在${source === 'gpt' ? 'GPT' : 'Sakura'}工作区配置翻译器`,
    );
    return false;
  }
  const volume = await (await repositoryPromise).getVolume(bookId.value);
  if (volume === undefined) {
    message.error('书籍不存在');
    return false;
  }
  automaticTranslationController?.abort();
  const config = createVisibleTranslationConfig(source, worker);
  const selection: ReaderAutomaticTranslationSelection = {
    source,
    workerId: worker.id,
    workerFingerprint: JSON.stringify(config),
    glossaryId: volume.glossaryId,
  };
  automaticTranslationSession.start(selection);
  automaticTranslationController = new AbortController();
  activeAutomaticTranslationRuntime = {
    selection,
    config,
    concurrency: normalizeTranslationConcurrency(worker.concurrency),
    glossary: { ...volume.glossary },
  };
  automaticTranslationSource.value = source;
  temporaryMode = settings.value.defaultMode;
  await restoreAutomaticTranslationDraft(selection);
  showMobileTranslationNotice.value = false;
  (document.activeElement as HTMLElement | null)?.blur();
  if (notify) {
    message.success(`已开启 ${source === 'gpt' ? 'GPT' : 'Sakura'} 自动翻译`);
  }
  await nextTick();
  scheduleAutomaticTranslation();
  return true;
};

const toggleAutomaticTranslation = async (
  source: ReaderAutomaticTranslationSource,
) => {
  if (automaticTranslationSource.value === source) {
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
  if (await startAutomaticTranslation(source, false)) {
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
        label:
          result.value.chapters.find(({ id }) => id === anchor.chapterId)
            ?.title ?? result.value.chapter.title,
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
    const wasCollapsed = collapsedCatalogEntryIds.value.has(entry.id);
    toggleCatalogEntry(entry.id);
    if (!wasCollapsed) return;
  }
  if (entry.href !== undefined && result.value?.chapter.epub !== undefined) {
    navigateToEpubHref(entry.href, true);
  } else if (entry.chapterId !== undefined) {
    navigate(entry.chapterId, undefined, true);
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

const replaceScrolledChapterRoute = (chapterId: string) => {
  if (requestedChapterId.value === chapterId) return;
  routeSyncedFromScroll = chapterId;
  void router.replace(
    `/books/${encodeURIComponent(bookId.value)}/read/${encodeURIComponent(chapterId)}`,
  );
};

const syncActiveContinuousChapter = () => {
  if (
    adjustingContinuousChapters ||
    resolvedFlow.value !== 'scrolled' ||
    result.value?.kind !== 'ready'
  ) {
    return;
  }
  const chapterId =
    getActiveContinuousChapterElement()?.dataset.readerChapterId;
  if (chapterId === undefined || chapterId === result.value.chapter.chapterId) {
    return;
  }
  const chapter = continuousChapters.value.find(
    (item) => item.chapterId === chapterId,
  );
  if (chapter === undefined) return;
  result.value = { ...result.value, chapter };
  replaceScrolledChapterRoute(chapterId);
};

const preserveChapterPosition = async (
  chapterId: string | undefined,
  previousTop: number | undefined,
) => {
  if (chapterId === undefined || previousTop === undefined) return;
  await nextTick();
  const nextTop =
    getContinuousChapterElement(chapterId)?.getBoundingClientRect().top;
  if (nextTop !== undefined) {
    window.scrollBy({ top: nextTop - previousTop, behavior: 'auto' });
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const trimContinuousChapters = async (direction: 'previous' | 'next') => {
  if (continuousChapters.value.length <= 5) return;
  if (direction === 'previous') {
    continuousChapters.value
      .slice(5)
      .forEach((chapter) =>
        continuousChapterInitialSegments.delete(chapter.chapterId),
      );
    continuousChapters.value = continuousChapters.value.slice(0, 5);
    return;
  }
  const anchor = continuousChapters.value[1];
  const previousTop = getContinuousChapterElement(
    anchor?.chapterId ?? '',
  )?.getBoundingClientRect().top;
  adjustingContinuousChapters = true;
  try {
    continuousChapters.value
      .slice(0, -5)
      .forEach((chapter) =>
        continuousChapterInitialSegments.delete(chapter.chapterId),
      );
    continuousChapters.value = continuousChapters.value.slice(-5);
    await preserveChapterPosition(anchor?.chapterId, previousTop);
  } finally {
    adjustingContinuousChapters = false;
  }
};

const loadContinuousChapter = async (direction: 'previous' | 'next') => {
  if (resolvedFlow.value !== 'scrolled' || result.value?.kind !== 'ready') {
    return;
  }
  const edge =
    direction === 'previous'
      ? continuousChapters.value[0]
      : continuousChapters.value.at(-1);
  if (edge === undefined) return;
  const summary =
    result.value.chapters[
      edge.chapterIndex + (direction === 'previous' ? -1 : 1)
    ];
  if (summary === undefined || continuousChapterLoads.has(summary.id)) return;
  const generation = continuousLoadGeneration;
  continuousChapterLoads.add(summary.id);
  try {
    const adapter = await cachedAdapterPromise;
    const chapter = withTemporaryTranslations(
      await adapter.getChapter({
        bookId: bookId.value,
        chapterId: summary.id,
      }),
    );
    if (
      generation !== continuousLoadGeneration ||
      continuousChapters.value.some(
        (item) => item.chapterId === chapter.chapterId,
      )
    ) {
      return;
    }
    if (direction === 'previous') {
      const anchor = continuousChapters.value[0];
      const previousTop = getContinuousChapterElement(
        anchor?.chapterId ?? '',
      )?.getBoundingClientRect().top;
      adjustingContinuousChapters = true;
      try {
        continuousChapterInitialSegments.set(
          chapter.chapterId,
          chapter.segments.at(-1)?.id,
        );
        continuousChapters.value = [chapter, ...continuousChapters.value];
        await preserveChapterPosition(anchor?.chapterId, previousTop);
      } finally {
        adjustingContinuousChapters = false;
      }
    } else {
      continuousChapterInitialSegments.set(
        chapter.chapterId,
        chapter.segments[0]?.id,
      );
      continuousChapters.value = [...continuousChapters.value, chapter];
      await nextTick();
    }
    await trimContinuousChapters(direction);
  } catch {
    // 邻章预加载失败不应中断当前章节阅读，显式切章仍会显示加载错误。
  } finally {
    if (generation === continuousLoadGeneration) {
      continuousChapterLoads.delete(summary.id);
    }
  }
};

const loadContinuousChaptersNearViewport = async () => {
  const elements = continuousChapterElements();
  const first = elements[0];
  const last = elements.at(-1);
  if (first?.getBoundingClientRect().top > -1200) {
    await loadContinuousChapter('previous');
  }
  if (last?.getBoundingClientRect().bottom < window.innerHeight + 1200) {
    await loadContinuousChapter('next');
  }
};

const initializeContinuousChapters = (chapter: ReaderChapterContent) => {
  continuousLoadGeneration += 1;
  continuousChapterLoads.clear();
  continuousChapterInitialSegments.clear();
  continuousChapterInitialSegments.set(
    chapter.chapterId,
    initialSegmentId.value ?? chapter.segments[0]?.id,
  );
  continuousChapters.value = resolvedFlow.value === 'scrolled' ? [chapter] : [];
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
      stopAutomaticTranslation(false);
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
      if (routeSyncedFromScroll === nextChapterId) {
        routeSyncedFromScroll = undefined;
        if (result.value.chapter.chapterId !== nextChapterId) {
          replaceScrolledChapterRoute(result.value.chapter.chapterId);
        }
        return;
      }
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
watch(completedTranslationTasks, (tasks, previousTasks) => {
  if (
    tasks.some(
      (task) =>
        !previousTasks.includes(task) && taskTargetsCurrentChapter(task),
    )
  ) {
    void refreshCurrentChapter();
  }
});

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

watch(resolvedFlow, async (flow, previousFlow) => {
  const segmentId = getActiveSegmentId(previousFlow);
  if (result.value?.kind === 'ready') {
    initializeContinuousChapters(result.value.chapter);
  }
  await nextTick();
  await nextTick();
  scrollToSegment(segmentId);
  updateViewportMetrics();
  if (flow === 'scrolled') {
    void loadContinuousChaptersNearViewport();
  }
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
    settings.value.autoTranslationPreloadPages,
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
      void startAutomaticTranslation(source, false);
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
    const segmentId = getActiveSegmentId();
    await nextTick();
    scrollToSegment(segmentId);
    updateViewportMetrics();
  },
);

onMounted(() => {
  void loadSettings();
  window.addEventListener('scroll', handleViewportScroll, { passive: true });
  window.addEventListener('resize', handleViewportResize, { passive: true });
  window.addEventListener('keydown', handleReaderKeydown);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});
onBeforeUnmount(() => {
  loadUiRequestId += 1;
  searchUiRequestId += 1;
  void controllerPromise.then((controller) => controller.cancel());
  void searchControllerPromise.then((controller) => controller.cancel());
  stopAutomaticTranslation(false);
  automaticTranslationSession.clearDrafts();
  window.removeEventListener('scroll', handleViewportScroll);
  window.removeEventListener('resize', handleViewportResize);
  if (viewportResizeFrame !== undefined) {
    cancelAnimationFrame(viewportResizeFrame);
  }
  window.removeEventListener('keydown', handleReaderKeydown);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
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
          :type="automaticTranslationSource === 'gpt' ? 'primary' : 'default'"
          :secondary="automaticTranslationSource !== 'gpt'"
          :aria-pressed="automaticTranslationSource === 'gpt'"
          @click="toggleAutomaticTranslation('gpt')"
        >
          GPT 自动翻译
        </n-button>
        <n-button
          size="tiny"
          :type="
            automaticTranslationSource === 'sakura' ? 'primary' : 'default'
          "
          :secondary="automaticTranslationSource !== 'sakura'"
          :aria-pressed="automaticTranslationSource === 'sakura'"
          @click="toggleAutomaticTranslation('sakura')"
        >
          Sakura 自动翻译
        </n-button>
        <n-button
          v-if="hasIncompleteChapter"
          size="tiny"
          secondary
          @click="openVisiblePageModePrompt"
        >
          阅读版本
        </n-button>
        <n-button
          v-if="hasIncompleteChapter"
          size="tiny"
          secondary
          @click="refreshCurrentChapter"
        >
          刷新本页
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

    <div
      v-if="
        controlsVisible &&
        showsAutomaticTranslationControls &&
        showMobileTranslationNotice
      "
      class="book-reader__translation-popover-layer"
      @click.self="showMobileTranslationNotice = false"
    >
      <n-alert
        class="book-reader__translation-popover"
        type="warning"
        :show-icon="false"
      >
        <div class="book-reader__translation-panel">
          <strong>{{ currentTranslationStatusLabel }}</strong>
          <div class="book-reader__translation-panel-actions">
            <n-button
              size="small"
              :type="
                automaticTranslationSource === 'gpt' ? 'primary' : 'default'
              "
              :aria-pressed="automaticTranslationSource === 'gpt'"
              @click="toggleAutomaticTranslation('gpt')"
            >
              GPT 自动翻译
            </n-button>
            <n-button
              size="small"
              :type="
                automaticTranslationSource === 'sakura' ? 'primary' : 'default'
              "
              :aria-pressed="automaticTranslationSource === 'sakura'"
              @click="toggleAutomaticTranslation('sakura')"
            >
              Sakura 自动翻译
            </n-button>
            <n-button
              v-if="hasIncompleteChapter"
              size="small"
              @click="openVisiblePageModePrompt"
            >
              阅读版本
            </n-button>
            <n-button
              v-if="hasIncompleteChapter"
              size="small"
              @click="refreshCurrentChapter"
            >
              刷新本页
            </n-button>
          </div>
        </div>
      </n-alert>
    </div>

    <div
      v-else-if="result?.kind === 'ready'"
      class="book-reader__chapter-status"
      :title="result.chapter.title"
    >
      {{ result.chapter.title }}
    </div>

    <section v-if="controlsVisible" class="book-reader__notices">
      <template v-if="result?.kind === 'ready'">
        <n-alert v-if="readingMode !== renderedMode" type="info">
          本章尚无可用译文，已显示原文。
        </n-alert>
      </template>
    </section>

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
      >
        <template v-if="resolvedFlow === 'scrolled'">
          <section
            v-for="(chapter, chapterIndex) in continuousChapters"
            :key="chapter.chapterId"
            class="book-reader__continuous-chapter"
            :data-reader-chapter-id="chapter.chapterId"
          >
            <h2
              v-if="chapterIndex > 0"
              class="book-reader__continuous-chapter-title"
            >
              {{ chapter.title }}
            </h2>
            <ReaderEpubLayout
              v-if="chapter.epub !== undefined"
              :epub="chapter.epub"
              :segments="chapter.segments"
              :mode="getChapterRenderedMode(chapter)"
              :flow="resolvedFlow"
              :double-spread="usesDoublePageSpread"
              :layout-revision="`${activeSettings.fontSize}/${activeSettings.lineHeight}/${activeSettings.horizontalPadding}`"
              @content-change="handleSegmentContentChange"
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
              continuous
              @content-change="handleSegmentContentChange"
            />
          </section>
        </template>
        <ReaderEpubLayout
          v-else-if="result.chapter.epub !== undefined"
          :epub="result.chapter.epub"
          :segments="result.chapter.segments"
          :mode="renderedMode"
          :flow="resolvedFlow"
          :double-spread="usesDoublePageSpread"
          :layout-revision="`${activeSettings.fontSize}/${activeSettings.lineHeight}/${activeSettings.horizontalPadding}`"
          @content-change="handleSegmentContentChange"
          @link-activate="navigateToEpubHref"
        />
        <ReaderSegmentLayout
          v-else
          ref="readerSegments"
          :segments="result.chapter.segments"
          :mode="renderedMode"
          :initial-segment-id="initialSegmentId"
          :flow="resolvedFlow"
          :scroll-root="readerViewport"
          @content-change="handleSegmentContentChange"
        />
      </article>
    </template>

    <nav
      v-if="controlsVisible && result?.kind === 'ready' && !loading"
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
      <button type="button" @click="openSettings">
        <n-icon :component="SettingsOutlined" />
        <span>设置</span>
      </button>
      <button type="button" @click="openTools">
        <n-icon :component="BuildOutlined" />
        <span>工具</span>
      </button>
      <button type="button" @click="openInteractiveTranslation">
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
              <span class="book-reader__catalog-title">{{ entry.title }}</span>
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
          v-if="hasIncompleteBookTranslation"
          @click="openAutomaticTranslatorSelection"
        >
          翻译器选择
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

    <ReaderBottomSheet
      v-model:show="showAutomaticTranslatorSelection"
      title="翻译器选择"
    >
      <n-form label-placement="top" class="book-reader__translator-selection">
        <n-form-item label="GPT 翻译器">
          <n-select
            v-model:value="automaticGptWorkerValue"
            :options="automaticGptWorkerOptions"
            :disabled="automaticGptWorkerOptions.length === 0"
            placeholder="尚未配置 GPT 翻译器"
          />
        </n-form-item>
        <n-form-item label="Sakura 翻译器">
          <n-select
            v-model:value="automaticSakuraWorkerValue"
            :options="automaticSakuraWorkerOptions"
            :disabled="automaticSakuraWorkerOptions.length === 0"
            placeholder="尚未配置 Sakura 翻译器"
          />
        </n-form-item>
      </n-form>
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
          <dd>{{ result.chapter.title }}</dd>
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

    <ReaderModeDialog
      v-model:show="showModePrompt"
      v-model:remember="rememberModeChoice"
      :modes="visiblePageModes"
      :source-language="
        result?.kind === 'ready' ? result.book.sourceLanguage : undefined
      "
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
                { label: '超暗', value: 'ultra-dark' },
                { label: '护眼', value: 'sepia' },
              ]"
            />
          </n-form-item>
        </div>
        <div class="book-reader__settings-theme">
          <n-form-item label="阅读流">
            <n-select
              v-model:value="settings.flow"
              :options="[
                { label: '自动（电脑分页，手机滚动）', value: 'auto' },
                { label: '分页', value: 'paginated' },
                { label: '滚动', value: 'scrolled' },
              ]"
            />
          </n-form-item>
        </div>
      </n-form>
    </ReaderBottomSheet>
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
  position: fixed;
  top: calc(var(--reader-app-bar-height) + 8px);
  right: 0;
  left: 0;
  z-index: 90;
  display: grid;
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 max(16px, var(--reader-padding));
  gap: 8px;
}

.book-reader__notices :deep(.n-alert-body),
.book-reader__notices :deep(.n-alert-content),
.book-reader__notices :deep(.n-space) {
  width: 100%;
}

.book-reader__translation-popover-layer {
  display: none;
}

.book-reader__translation-popover {
  width: min(100%, 720px);
  margin: 0 auto;
  color: var(--reader-warning-text);
  background: var(--reader-warning-background);
  border: 1px solid var(--reader-warning-border);
  box-shadow: 0 10px 30px rgb(0 0 0 / 30%);
}

.book-reader__translation-panel {
  display: grid;
  width: 100%;
  color: var(--reader-warning-text);
  text-align: center;
  gap: 12px;
}

.book-reader__translation-panel strong {
  font-size: 16px;
}

.book-reader__translation-panel-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.book-reader__translation-panel-actions :deep(.n-button__content) {
  color: var(--reader-warning-text);
}

.book-reader__translation-panel-actions :deep(.n-button__border),
.book-reader__translation-panel-actions :deep(.n-button__state-border) {
  border-color: var(--reader-warning-button-border) !important;
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

.book-reader__translator-selection {
  display: grid;
  gap: 2px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 32px;
}

.book-reader__settings-theme {
  grid-column: 1 / -1;
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

.book-reader__continuous-chapter-title {
  margin: 0 0 1em;
  color: var(--reader-muted-color);
  font-size: 0.92em;
  font-weight: 600;
  line-height: 1.5;
}

.book-reader__content--paginated {
  --reader-page-padding: max(
    28px,
    var(--reader-padding),
    calc((100vw - 860px) / 2)
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
    calc((50vw - 860px) / 2)
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

  .book-reader__translation-popover-layer {
    position: fixed;
    top: var(--reader-app-bar-height);
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 101;
    display: block;
    padding: 8px 14px;
  }

  .book-reader__chapter-status {
    top: 6px;
    left: 14px;
    max-width: calc(100vw - 28px);
    font-size: 12px;
  }

  .book-reader__notices {
    top: calc(var(--reader-app-bar-height) + 8px);
    padding: 0 14px;
  }

  .book-reader__content {
    padding: 18px max(22px, env(safe-area-inset-left)) 36px;
    font-size: var(--reader-font-size);
    line-height: var(--reader-line-height);
  }

  .book-reader__content--paginated {
    --reader-page-padding: max(22px, env(safe-area-inset-left));
    height: calc(100dvh - 34px);
    padding: 0;
  }

  .book-reader__content--paginated :deep(.reader-segment-layout) {
    padding: 46px var(--reader-page-padding) 18px;
    column-count: 1;
    column-gap: calc(var(--reader-page-padding) * 2);
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
</style>
