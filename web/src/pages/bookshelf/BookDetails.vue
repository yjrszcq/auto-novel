<script lang="ts" setup>
import type {
  ReaderBook,
  ReaderBookStyleOverride,
  ReaderChapterSummary,
  ReaderProgress,
  ReaderReadingStats,
} from '@/model/Reader';
import { useKeyModifier } from '@vueuse/core';
import { useRouter } from 'vue-router';

import BookCover from './components/BookCover.vue';
import {
  getReadingProgress,
  getTranslationProgress,
} from './BookshelfPresentation';
import {
  createBookshelfService,
  type BookshelfEntry,
} from './BookshelfService';
import { createLocalVolumeReaderAdapter } from '../reader/adapters/LocalVolumeReaderAdapter';
import {
  readerModeLabels,
  readerModes,
  type SelectableReaderMode,
} from '../reader/core/ReaderMode';
import { formatReadingDuration } from '../reader/core/ReaderStats';

import { useLocalVolumeManager } from '../workspace/LocalVolumeManager';

import { useLocalVolumeStore, useSettingStore } from '@/stores';
import { downloadFile } from '@/util';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const loading = ref(true);
const error = ref<string>();
const book = shallowRef<ReaderBook>();
const bookTheme = ref<'global' | NonNullable<ReaderBookStyleOverride['theme']>>(
  'global',
);
const showCatalog = ref(false);
const entry = shallowRef<BookshelfEntry>();
const chapters = ref<ReaderChapterSummary[]>([]);
const progress = shallowRef<ReaderProgress>();
const readingStats = shallowRef<ReaderReadingStats>();
const bookmarkCount = ref(0);
const preferredMode = ref<'global' | SelectableReaderMode>('global');
const coverInput = ref<HTMLInputElement>();
const coverVersion = ref(0);
const repositoryPromise = useLocalVolumeStore();
const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);
const localVolumeManager = useLocalVolumeManager();
const shouldTopJob = useKeyModifier('Control');

const bookId = computed(() => String(route.params.bookId));
const readingProgress = computed(() =>
  entry.value === undefined
    ? 0
    : getReadingProgress({ ...entry.value, progress: progress.value }),
);
const translationProgress = computed(() =>
  entry.value === undefined ? 0 : getTranslationProgress(entry.value.volume),
);
const completedChapters = computed(
  () =>
    chapters.value.filter((chapter) => chapter.translationStatus === 'complete')
      .length,
);
const modeLabel = (mode: 'global' | SelectableReaderMode) =>
  mode === 'global' ? '跟随全局设置' : readerModeLabels[mode];
const readingModeOptions = [
  { label: '跟随全局设置', value: 'global' },
  ...readerModes.map((mode) => ({ label: modeLabel(mode), value: mode })),
];
const bookThemeOptions = [
  { label: '跟随全局设置', value: 'global' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '护眼', value: 'sepia' },
  { label: '跟随系统', value: 'system' },
];
const languageLabel = computed(() =>
  book.value?.targetLanguage === undefined
    ? book.value?.sourceLanguage ?? '本地文本'
    : book.value.sourceLanguage + ' → ' + book.value.targetLanguage,
);
const translationStatusLabels = {
  none: '未翻译',
  partial: '部分译文',
  complete: '已翻译',
} as const;
type LocalTranslator = 'gpt' | 'sakura';

const formatDate = (value: number | undefined) =>
  value === undefined ? '—' : new Date(value).toLocaleString('zh-CN');

const load = async () => {
  loading.value = true;
  error.value = undefined;
  try {
    const repository = await repositoryPromise;
    const service = createBookshelfService(repository);
    const adapter = createLocalVolumeReaderAdapter(repository);
    const [
      entries,
      loadedBook,
      loadedChapters,
      loadedProgress,
      loadedReadingStats,
      preference,
      bookmarks,
    ] = await Promise.all([
      service.ensureIndex(),
      adapter.getBook(bookId.value),
      adapter.getChapters(bookId.value),
      repository.getReaderProgress(bookId.value),
      repository.getReaderReadingStats(bookId.value),
      repository.getReaderBookPreference(bookId.value),
      repository.listReaderBookmarks(bookId.value),
    ]);
    const loadedEntry = entries.find(
      (candidate) => candidate.volume.id === bookId.value,
    );
    if (loadedEntry === undefined) {
      throw new Error('书籍不存在');
    }
    entry.value = loadedEntry;
    book.value = loadedBook;
    chapters.value = loadedChapters;
    progress.value = loadedProgress;
    readingStats.value = loadedReadingStats;
    bookmarkCount.value = bookmarks.length;
    preferredMode.value = preference?.preferredMode ?? 'global';
    bookTheme.value = preference?.style?.theme ?? 'global';
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法加载书籍详情';
  } finally {
    loading.value = false;
  }
};

const returnToShelf = () => void router.push('/bookshelf');

const startReading = () => {
  const chapterId =
    progress.value?.chapterId ?? entry.value?.volume.toc[0]?.chapterId;
  if (chapterId === undefined) {
    message.warning('这本书还没有可阅读章节');
    return;
  }
  void router.push(
    '/books/' +
      encodeURIComponent(bookId.value) +
      '/read/' +
      encodeURIComponent(chapterId),
  );
};

const savePreference = async (value: string) => {
  const repository = await repositoryPromise;
  const existing = await repository.getReaderBookPreference(bookId.value);
  await repository.putReaderBookPreference({
    ...existing,
    bookId: bookId.value,
    preferredMode:
      value === 'global' ? undefined : (value as SelectableReaderMode),
    updatedAt: Date.now(),
  });
  preferredMode.value = value as 'global' | SelectableReaderMode;
};

const saveBookTheme = async (value: string) => {
  const repository = await repositoryPromise;
  const existing = await repository.getReaderBookPreference(bookId.value);
  await repository.putReaderBookPreference({
    ...existing,
    bookId: bookId.value,
    style: {
      ...existing?.style,
      theme:
        value === 'global'
          ? undefined
          : (value as NonNullable<ReaderBookStyleOverride['theme']>),
    },
    updatedAt: Date.now(),
  });
  bookTheme.value = value as typeof bookTheme.value;
};

const openChapter = (chapterId: string) => {
  showCatalog.value = false;
  void router.push(
    '/books/' +
      encodeURIComponent(bookId.value) +
      '/read/' +
      encodeURIComponent(chapterId),
  );
};

const downloadOriginal = async () => {
  try {
    const repository = await repositoryPromise;
    const file = await repository.getFile(bookId.value);
    if (file === undefined) {
      message.error('原始文件不存在');
      return;
    }
    downloadFile(bookId.value, file.file);
    message.success('已开始下载原文');
  } catch (reason) {
    message.error('下载失败：' + String(reason));
  }
};

const downloadTranslated = async () => {
  const translations = setting.value.downloadFormat.translations.filter(
    (translator): translator is LocalTranslator =>
      translator === 'gpt' || translator === 'sakura',
  );
  if (translations.length === 0) {
    message.warning('请先在设置中启用 GPT 或 Sakura');
    return;
  }
  try {
    const repository = await repositoryPromise;
    const { filename, blob } = await repository.getTranslationFile({
      id: bookId.value,
      mode: setting.value.homeDownloadMode,
      translationsMode: setting.value.downloadFormat.translationsMode,
      translations,
    });
    downloadFile(filename, blob);
    message.success('已开始下载译文');
  } catch (reason) {
    message.error('下载失败：' + String(reason));
  }
};

const queueBook = (type: LocalTranslator) => {
  const results = localVolumeManager.queueJobToWorkspace(bookId.value, {
    level: 'all',
    type,
    shouldTop: shouldTopJob.value,
    startIndex: 0,
    endIndex: 65535,
    taskNumber: 1,
    total: chapters.value.length || 65535,
  });
  const success = results.every((result) => result);
  message[success ? 'success' : 'error'](
    success
      ? (book.value?.title ?? bookId.value) +
          ' 已加入' +
          (type === 'gpt' ? ' GPT' : ' Sakura') +
          '工作区'
      : '对应工作区已经有这本书的翻译任务',
  );
};

const queueGpt = () => queueBook('gpt');
const queueSakura = () => queueBook('sakura');

const toggleListed = async () => {
  if (entry.value === undefined) {
    return;
  }
  const repository = await repositoryPromise;
  await createBookshelfService(repository).setListed(
    bookId.value,
    !entry.value.state.listed,
  );
  await load();
};

const togglePinned = async () => {
  if (entry.value === undefined) {
    return;
  }
  const repository = await repositoryPromise;
  await createBookshelfService(repository).setPinned(
    bookId.value,
    !entry.value.state.pinned,
  );
  await load();
};

const selectCover = () => coverInput.value?.click();

const updateCover = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined) {
    return;
  }
  if (!file.type.startsWith('image/')) {
    message.warning('请选择图片文件');
    return;
  }
  const repository = await repositoryPromise;
  await repository.putReaderCover({
    bookId: bookId.value,
    blob: file,
    source: 'custom',
    updatedAt: Date.now(),
  });
  coverVersion.value += 1;
  message.success('封面已保存到当前浏览器');
};
const removeCover = async () => {
  const repository = await repositoryPromise;
  const cover = await repository.getReaderCover(bookId.value);
  if (cover?.source === 'embedded') {
    message.info('当前使用 EPUB 内嵌封面');
    return;
  }
  await repository.deleteReaderCover(bookId.value);
  coverVersion.value += 1;
  message.success('已移除自定义封面');
};

onMounted(() => void load());
</script>

<template>
  <main class="book-details">
    <header class="layout-content book-details__header">
      <div>
        <p class="book-details__eyebrow">LOCAL BOOK</p>
        <p class="book-details__privacy">
          书籍、封面与阅读数据仅保存在当前浏览器。
        </p>
      </div>
      <n-button @click="returnToShelf">返回书架</n-button>
    </header>

    <div v-if="loading" class="layout-content book-details__status">
      <n-spin size="large" />
    </div>
    <div
      v-else-if="error !== undefined"
      class="layout-content book-details__status"
    >
      <n-alert title="无法加载书籍" type="error">{{ error }}</n-alert>
    </div>

    <template v-else-if="book !== undefined && entry !== undefined">
      <section class="book-details__hero">
        <div class="layout-content book-details__hero-content">
          <BookCover
            :book-id="book.id"
            :refresh-key="coverVersion"
            :title="book.title"
            select-label="选择本地封面"
            @select="selectCover"
          />
          <div class="book-details__hero-copy">
            <h1>{{ book.title }}</h1>
            <n-space class="book-details__facts" size="small" wrap>
              <n-tag :bordered="false" size="small">本地书籍</n-tag>
              <n-tag :bordered="false" size="small">
                {{ book.chapterCount }} 章
              </n-tag>
              <n-tag :bordered="false" size="small">{{ languageLabel }}</n-tag>
            </n-space>
            <dl class="book-details__metadata">
              <div>
                <dt>导入时间</dt>
                <dd>{{ formatDate(book.createdAt) }}</dd>
              </div>
              <div>
                <dt>上次阅读</dt>
                <dd>{{ formatDate(progress?.updatedAt) }}</dd>
              </div>
              <div>
                <dt>累计阅读</dt>
                <dd>
                  {{ formatReadingDuration(readingStats?.totalReadingMs ?? 0) }}
                </dd>
              </div>
              <div>
                <dt>书签</dt>
                <dd>{{ bookmarkCount }}</dd>
              </div>
            </dl>
            <n-space class="book-details__actions" size="small" wrap>
              <n-button type="primary" @click="startReading">
                {{ progress === undefined ? '开始阅读' : '继续阅读' }}
              </n-button>
              <n-button @click="showCatalog = true">打开目录</n-button>
              <n-button @click="downloadOriginal">下载原文</n-button>
              <n-button @click="downloadTranslated">下载译文</n-button>
              <n-button @click="queueGpt">排队 GPT</n-button>
              <n-button @click="queueSakura">排队 Sakura</n-button>
            </n-space>
            <p class="book-details__queue-hint">
              按住 Ctrl 点击排队，可将任务自动置顶。
            </p>
          </div>
        </div>
      </section>

      <div class="layout-content book-details__body">
        <n-card class="book-details__section book-details__progress-card">
          <template #header>
            <h2>阅读与翻译进度</h2>
          </template>
          <div class="book-details__progress">
            <div class="book-details__progress-item">
              <div class="book-details__progress-label">
                <span>阅读进度</span>
                <strong>{{ Math.round(readingProgress) }}%</strong>
              </div>
              <n-progress
                :percentage="Math.round(readingProgress)"
                :show-indicator="false"
                status="success"
              />
            </div>
            <div class="book-details__progress-item">
              <div class="book-details__progress-label">
                <span>翻译进度</span>
                <strong>{{ completedChapters }} / {{ chapters.length }}</strong>
              </div>
              <n-progress
                :percentage="Math.round(translationProgress)"
                :show-indicator="false"
                type="info"
              />
            </div>
          </div>
        </n-card>

        <n-card class="book-details__section">
          <template #header>
            <h2>阅读偏好</h2>
          </template>
          <n-form label-placement="top">
            <n-form-item label="打开方式">
              <n-select
                :options="readingModeOptions"
                :value="preferredMode"
                @update:value="savePreference"
              />
            </n-form-item>
            <n-form-item label="本书主题覆盖">
              <n-select
                :options="bookThemeOptions"
                :value="bookTheme"
                @update:value="saveBookTheme"
              />
            </n-form-item>
          </n-form>
        </n-card>

        <n-card class="book-details__section">
          <template #header>
            <h2>封面与书架</h2>
          </template>
          <input
            ref="coverInput"
            accept="image/*"
            hidden
            type="file"
            @change="updateCover"
          />
          <n-space size="small" wrap>
            <n-button @click="selectCover">选择本地封面</n-button>
            <n-button @click="removeCover">移除自定义封面</n-button>
            <n-button @click="togglePinned">
              {{ entry.state.pinned ? '取消置顶' : '置顶书籍' }}
            </n-button>
            <n-button type="warning" @click="toggleListed">
              {{ entry.state.listed ? '移出书架' : '加入书架' }}
            </n-button>
          </n-space>
        </n-card>
      </div>

      <n-drawer
        v-model:show="showCatalog"
        placement="right"
        width="min(440px, 92vw)"
      >
        <n-drawer-content title="打开目录">
          <p class="book-details__catalog-summary">
            共 {{ chapters.length }} 章
          </p>
          <n-list hoverable>
            <n-list-item v-for="chapter in chapters" :key="chapter.id">
              <n-button
                block
                class="book-details__catalog-button"
                text
                @click="openChapter(chapter.id)"
              >
                <span class="book-details__catalog-index">
                  第 {{ chapter.index + 1 }} 章
                </span>
                <span class="book-details__catalog-title">
                  {{ chapter.title }}
                </span>
                <n-tag :bordered="false" size="small">
                  {{ translationStatusLabels[chapter.translationStatus] }}
                </n-tag>
              </n-button>
            </n-list-item>
          </n-list>
        </n-drawer-content>
      </n-drawer>
    </template>
  </main>
</template>

<style scoped>
.book-details {
  padding-bottom: 48px;
}

.book-details__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 20px;
  padding-bottom: 16px;
}

.book-details__eyebrow,
.book-details__privacy,
.book-details__queue-hint,
.book-details__catalog-summary {
  margin: 0;
}

.book-details__eyebrow {
  color: var(--n-primary-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.book-details__privacy,
.book-details__queue-hint,
.book-details__catalog-summary {
  color: var(--n-text-color-3);
  font-size: 13px;
}

.book-details__status {
  display: grid;
  min-height: 220px;
  place-items: center;
}

.book-details__hero {
  position: relative;
  overflow: hidden;
  border-top: 1px solid var(--n-border-color);
  border-bottom: 1px solid var(--n-border-color);
  background: radial-gradient(
      circle at 72% 18%,
      rgb(91 103 145 / 22%),
      transparent 44%
    ),
    var(--n-card-color);
}

.book-details__hero::before {
  position: absolute;
  inset: -80px;
  z-index: 0;
  background: var(--n-primary-color);
  content: '';
  filter: blur(96px);
  opacity: 0.08;
}

.book-details__hero-content {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 28px;
  padding-top: 28px;
  padding-bottom: 28px;
}

.book-details__hero-content :deep(.book-cover) {
  width: min(180px, 34vw);
  flex: none;
  border-radius: 4px;
  box-shadow: 0 16px 34px rgb(0 0 0 / 24%);
}

.book-details__hero-copy {
  min-width: 0;
}

.book-details__hero-copy h1,
.book-details__section h2 {
  margin: 0;
}

.book-details__hero-copy h1 {
  font-size: clamp(22px, 3vw, 32px);
  line-height: 1.28;
}

.book-details__facts {
  margin-top: 12px;
}

.book-details__metadata {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 28px;
  margin: 20px 0;
}

.book-details__metadata div {
  display: grid;
  gap: 3px;
}

.book-details__metadata dt {
  color: var(--n-text-color-3);
  font-size: 12px;
}

.book-details__metadata dd {
  margin: 0;
}

.book-details__actions {
  align-items: center;
}

.book-details__queue-hint {
  margin-top: 10px;
}

.book-details__body {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
  gap: 16px;
  padding-top: 24px;
}

.book-details__section {
  min-width: 0;
}

.book-details__progress-card {
  grid-row: span 2;
}

.book-details__progress {
  display: grid;
  gap: 24px;
}

.book-details__progress-item {
  display: grid;
  gap: 8px;
}

.book-details__progress-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.book-details__progress-label span {
  color: var(--n-text-color-2);
}

.book-details__catalog-summary {
  margin-bottom: 12px;
}

.book-details__catalog-button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  width: 100%;
  gap: 10px;
  padding: 8px 0;
  text-align: left;
}

.book-details__catalog-index {
  color: var(--n-text-color-2);
  white-space: nowrap;
}

.book-details__catalog-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media only screen and (max-width: 700px) {
  .book-details__header,
  .book-details__hero-content {
    align-items: stretch;
    flex-direction: column;
  }

  .book-details__hero-content {
    gap: 18px;
  }

  .book-details__hero-content :deep(.book-cover) {
    width: min(180px, 58vw);
  }

  .book-details__metadata,
  .book-details__body {
    grid-template-columns: 1fr;
  }

  .book-details__progress-card {
    grid-row: auto;
  }
}
</style>
