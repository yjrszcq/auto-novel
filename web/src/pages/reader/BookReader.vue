<script lang="ts" setup>
import type { ReaderMode, ReaderSettingsRecord } from '@/model/Reader';
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
import { getAvailableReaderModes, resolveReaderMode } from './core/ReaderMode';
import {
  defaultReaderSettings,
  normalizeReaderSettings,
} from './core/ReaderSettings';

import { useLocalVolumeStore } from '@/stores';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const result = shallowRef<ReaderPageLoadResult>();
const showSettings = ref(false);
const showModePrompt = ref(false);
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
let temporaryMode: Exclude<ReaderMode, 'ask'> | undefined;
const settings = ref<ReaderSettingsRecord>({ ...defaultReaderSettings });
let settingsLoaded = false;

const repositoryPromise = useLocalVolumeStore();
const controllerPromise = repositoryPromise.then((repository) =>
  createReaderPageController(createLocalVolumeReaderAdapter(repository)),
);

const bookId = computed(() => route.params.bookId as string);
const requestedChapterId = computed(() =>
  typeof route.params.chapterId === 'string'
    ? route.params.chapterId
    : undefined,
);
const renderedMode = computed(() =>
  result.value?.kind === 'ready'
    ? resolveRenderedReaderMode(
        readingMode.value,
        result.value.chapter.segments,
      )
    : 'original',
);

const readerStyle = computed(() => ({
  '--reader-font-size': `${settings.value.fontSize}px`,
  '--reader-line-height': settings.value.lineHeight,
  '--reader-content-width': `${settings.value.contentWidth}px`,
  '--reader-padding': `${settings.value.horizontalPadding}px`,
}));

const loadSettings = async () => {
  const repository = await repositoryPromise;
  settings.value = normalizeReaderSettings(
    await repository.getReaderSettings(),
  );
  settingsLoaded = true;
};

const load = async () => {
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
    await Promise.all([restoreProgress(loaded), resolveMode(loaded)]);
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
    await repository.putReaderBookPreference({
      bookId: bookId.value,
      preferredMode: mode,
      updatedAt: Date.now(),
    });
  }
};

const getSegmentElements = () => [
  ...document.querySelectorAll<HTMLElement>('[data-reader-segment-id]'),
];

const restoreProgress = async (
  loaded: Extract<ReaderPageLoadResult, { kind: 'ready' }>,
) => {
  const repository = await repositoryPromise;
  const progress = await repository.getReaderProgress(loaded.book.id);
  if (progress?.chapterId !== loaded.chapter.chapterId) {
    return;
  }
  await nextTick();
  const segment = resolveProgressSegment(loaded.chapter.segments, progress);
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

const navigate = (chapterId: string) => {
  void saveProgress();
  void router.push(
    `/books/${encodeURIComponent(bookId.value)}/read/${encodeURIComponent(chapterId)}`,
  );
};

const backToBookshelf = () => void router.push('/bookshelf');
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
  settings,
  async (value) => {
    if (!settingsLoaded) {
      return;
    }
    const repository = await repositoryPromise;
    await repository.putReaderSettings({ ...value, updatedAt: Date.now() });
  },
  { deep: true },
);

onMounted(() => {
  void loadSettings();
  window.addEventListener('scroll', saveProgressThrottled, { passive: true });
  document.addEventListener('visibilitychange', saveProgress);
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', saveProgressThrottled);
  document.removeEventListener('visibilitychange', saveProgress);
  void saveProgress();
});
</script>

<template>
  <main
    class="book-reader"
    :class="`book-reader--${settings.theme}`"
    :style="readerStyle"
  >
    <header class="book-reader__header">
      <n-button text @click="backToBookshelf">返回书架</n-button>
      <n-button text @click="showSettings = true">阅读设置</n-button>
      <n-button text @click="showModePrompt = true">切换模式</n-button>
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
