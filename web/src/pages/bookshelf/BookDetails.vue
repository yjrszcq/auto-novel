<script lang="ts" setup>
import type {
  ReaderBook,
  ReaderBookStyleOverride,
  ReaderChapterSummary,
  ReaderProgress,
  ReaderReadingStats,
} from '@/model/Reader';
import { shouldEmbedDownloadMetadata } from '@/model/LocalVolume';
import { useKeyModifier } from '@vueuse/core';
import { useRouter } from 'vue-router';

import BookCover from './components/BookCover.vue';
import { sanitizeBookDescription } from './BookDescription';
import { getReadingProgress } from './BookshelfPresentation';
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
const vars = useThemeVars();
const loading = ref(true);
const error = ref<string>();
const migrationWarning = ref<string>();
const book = shallowRef<ReaderBook>();
const bookTheme = ref<'global' | NonNullable<ReaderBookStyleOverride['theme']>>(
  'global',
);
const showCatalog = ref(false);
const showBookInfo = ref(false);
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
const description = computed(() => book.value?.description?.trim() ?? '');
const descriptionHtml = computed(() =>
  sanitizeBookDescription(description.value),
);
const formatMetadataList = (values: string[] | undefined) =>
  values?.length ? values.join('\n') : '—';
const languageLabels: Record<string, string> = {
  zh: '中文',
  ja: '日语',
  en: '英语',
  ko: '韩语',
};
const formatLanguage = (language: string) => {
  const label = languageLabels[language.toLowerCase().split('-')[0]];
  return label === undefined ? language : `${label}（${language}）`;
};
const formattedLanguages = computed(() =>
  book.value?.languages?.length
    ? book.value.languages.map(formatLanguage).join('\n')
    : '—',
);
const translatorCompleted = (type: LocalTranslator) =>
  entry.value?.volume.toc.filter(
    (chapter) => chapter[type] === entry.value?.volume.glossaryId,
  ).length ?? 0;
const gptCompleted = computed(() => translatorCompleted('gpt'));
const sakuraCompleted = computed(() => translatorCompleted('sakura'));

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
  migrationWarning.value = undefined;
  try {
    const repository = await repositoryPromise;
    const migration = await repository.ensureNativeEpubMigration(bookId.value);
    if (migration.status === 'failed') {
      migrationWarning.value = migration.message;
    }
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
const editBook = () =>
  void router.push('/books/' + encodeURIComponent(bookId.value) + '/edit');

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
    const file = await repository.getOriginalDownloadFile({
      id: bookId.value,
      embedMetadata: shouldEmbedDownloadMetadata(
        entry.value!.volume,
        'original',
        setting.value.embedMetadataInOriginalDownload,
      ),
    });
    downloadFile(file.filename, file.blob);
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
      embedMetadata: shouldEmbedDownloadMetadata(
        entry.value!.volume,
        'translated',
        setting.value.embedMetadataInTranslatedDownload,
      ),
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
      <section
        class="book-details__hero"
        :style="{
          '--book-details-cover-shadow':
            vars.bodyColor == '#fff'
              ? '0 3px 6px rgb(0 0 0 / 14%)'
              : '0 14px 28px rgb(0 0 0 / 24%)',
        }"
      >
        <div
          class="book-details__backdrop"
          aria-hidden="true"
          :style="{
            '--book-details-overlay-start':
              vars.bodyColor == '#fff' ? '#ffffff80' : 'rgba(16, 16, 20, 0.5)',
            '--book-details-overlay-end': vars.bodyColor,
          }"
        >
          <BookCover
            :book-id="book.id"
            :refresh-key="coverVersion"
            :title="book.title"
            visual-only
          />
        </div>
        <div class="layout-content book-details__hero-content">
          <BookCover
            :book-id="book.id"
            :refresh-key="coverVersion"
            :title="book.title"
            allow-custom-cover-removal
            select-label="选择本地封面"
            @remove="removeCover"
            @select="selectCover"
          />
          <div class="book-details__hero-side">
            <n-flex class="book-details__hero-copy" vertical>
              <n-h2 class="book-details__title" prefix="bar">
                <b>{{ book.title }}</b>
              </n-h2>
              <div
                class="book-details__hero-summary"
                :style="{
                  '--book-details-summary-color': vars.textColor3,
                  '--book-details-info-highlight-color':
                    vars.bodyColor == '#fff' ? vars.textColor1 : '#fff',
                }"
              >
                <n-text class="book-details__reading-progress" depth="3">
                  阅读进度 {{ Math.round(readingProgress) }}%
                </n-text>
                <div class="book-details__info-actions">
                  <button
                    class="book-details__info-button"
                    type="button"
                    @click="showBookInfo = true"
                  >
                    书籍信息
                  </button>
                  <button
                    aria-label="编辑书籍信息"
                    class="book-details__edit-button"
                    type="button"
                    @click="editBook"
                  >
                    <n-icon>
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path
                          d="M3 21q-.825 0-1.412-.587T1 19V5q0-.825.588-1.412T3 3h8v2H3v14h14v-8h2v8q0 .825-.587 1.413T17 21H3Zm4-4v-4.25l9.175-9.175q.3-.3.675-.45t.75-.15q.4 0 .775.15t.675.45l1.375 1.4q.3.3.438.675T21 6.4q0 .375-.137.738t-.438.662L11.25 17H7Zm2-2h1.4l5.8-5.8-1.4-1.4L9 13.6V15Z"
                          fill="currentColor"
                        />
                      </svg>
                    </n-icon>
                  </button>
                </div>
              </div>
            </n-flex>
            <n-flex
              class="book-details__hero-shelf-actions"
              justify="end"
              size="small"
              :wrap="false"
            >
              <n-button @click="togglePinned">
                {{ entry.state.pinned ? '取消置顶' : '置顶书籍' }}
              </n-button>
              <n-button type="warning" @click="toggleListed">
                {{ entry.state.listed ? '移出书架' : '加入书架' }}
              </n-button>
            </n-flex>
          </div>
        </div>
      </section>

      <div class="layout-content book-details__content">
        <n-alert
          v-if="migrationWarning !== undefined"
          type="warning"
          style="margin-bottom: 20px"
        >
          {{ migrationWarning }}；现有书籍仍可继续阅读。
        </n-alert>
        <div class="book-details__primary-actions">
          <n-flex size="small" wrap>
            <n-button type="primary" @click="startReading">
              {{ progress === undefined ? '开始阅读' : '继续阅读' }}
            </n-button>
            <n-button @click="showCatalog = true">打开目录</n-button>
          </n-flex>
          <n-button
            class="book-details__return-to-shelf"
            @click="returnToShelf"
          >
            返回书架
          </n-button>
        </div>

        <!-- The description is sanitized with an attribute-free allowlist. -->
        <!-- eslint-disable vue/no-v-html -->
        <section
          v-if="description.length > 0"
          class="book-details__description"
          aria-label="书籍简介"
          v-html="descriptionHtml"
        />
        <!-- eslint-enable vue/no-v-html -->

        <section-header
          class="book-details__preferences-header"
          title="阅读偏好"
        />
        <n-flex class="book-details__settings" vertical>
          <div class="book-details__setting-row">
            <n-text depth="3">打开方式</n-text>
            <n-select
              :options="readingModeOptions"
              :value="preferredMode"
              class="book-details__select"
              @update:value="savePreference"
            />
          </div>
          <div class="book-details__setting-row">
            <n-text depth="3">本书主题</n-text>
            <n-select
              :options="bookThemeOptions"
              :value="bookTheme"
              class="book-details__select"
              @update:value="saveBookTheme"
            />
          </div>
        </n-flex>

        <input
          ref="coverInput"
          accept="image/*"
          hidden
          type="file"
          @change="updateCover"
        />
        <section-header
          class="book-details__translation-header"
          title="翻译与下载"
        />
        <n-list class="book-details__volume-list">
          <n-list-item>
            <n-flex align="center" justify="space-between" :wrap="false">
              <n-flex :size="4" vertical>
                <n-text>{{ book.id }}</n-text>
                <n-text depth="3">
                  总计 {{ chapters.length }} / GPT {{ gptCompleted }} / Sakura
                  {{ sakuraCompleted }}
                </n-text>
                <n-flex size="small" wrap>
                  <n-button size="tiny" secondary @click="queueGpt">
                    排队GPT
                  </n-button>
                  <n-button size="tiny" secondary @click="queueSakura">
                    排队Sakura
                  </n-button>
                  <n-button size="tiny" secondary @click="downloadTranslated">
                    下载译文
                  </n-button>
                  <n-button size="tiny" secondary @click="downloadOriginal">
                    下载原文
                  </n-button>
                </n-flex>
              </n-flex>
            </n-flex>
          </n-list-item>
        </n-list>
        <p class="book-details__queue-hint">
          按住 Ctrl 点击排队，可将任务自动置顶。
        </p>
      </div>

      <n-drawer
        v-model:show="showCatalog"
        placement="right"
        width="min(440px, 84vw)"
      >
        <n-drawer-content :closable="false">
          <template #header>
            <div class="book-details__catalog-header">
              <button
                class="book-details__catalog-close"
                type="button"
                @click="showCatalog = false"
              >
                目录
              </button>
              <n-text depth="3">共 {{ chapters.length }} 章</n-text>
            </div>
          </template>
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

      <n-modal v-model:show="showBookInfo">
        <n-card
          class="book-details__info-dialog"
          closable
          title="书籍信息"
          @close="showBookInfo = false"
        >
          <dl class="book-details__info-list">
            <div class="book-details__info-item">
              <dt>作者</dt>
              <dd>{{ formatMetadataList(book.authors) }}</dd>
            </div>
            <div class="book-details__info-item">
              <dt>语言</dt>
              <dd>{{ formattedLanguages }}</dd>
            </div>
            <div class="book-details__info-item">
              <dt>章节</dt>
              <dd>{{ book.chapterCount }} 章</dd>
            </div>
            <div class="book-details__info-item">
              <dt>书签</dt>
              <dd>{{ bookmarkCount }}</dd>
            </div>
            <div class="book-details__info-item">
              <dt>导入时间</dt>
              <dd>{{ formatDate(book.createdAt) }}</dd>
            </div>
            <div class="book-details__info-item">
              <dt>上次阅读</dt>
              <dd>{{ formatDate(progress?.updatedAt) }}</dd>
            </div>
            <div class="book-details__info-item">
              <dt>累计阅读</dt>
              <dd>
                {{ formatReadingDuration(readingStats?.totalReadingMs ?? 0) }}
              </dd>
            </div>
            <div class="book-details__info-item book-details__info-item--wide">
              <dt>本地文件</dt>
              <dd>{{ book.id }}</dd>
            </div>
          </dl>
        </n-card>
      </n-modal>
    </template>
  </main>
</template>

<style scoped>
.book-details {
  padding-bottom: 48px;
}

.book-details__status {
  display: grid;
  min-height: 220px;
  place-items: center;
}

.book-details__title :deep(.n-h__prefix) {
  align-self: stretch;
}

.book-details__title {
  align-items: center;
}

.book-details__title b {
  flex: 0 1 auto;
  min-width: 0;
}

.book-details__edit-button {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 0;
  border: 0;
  color: var(--book-details-summary-color);
  background: transparent;
  cursor: pointer;
  line-height: 1;
}

.book-details__edit-button :deep(.n-icon) {
  font-size: 18px;
}

.book-details__hero {
  position: relative;
  overflow: hidden;
}

.book-details__backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.book-details__backdrop::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    var(--book-details-overlay-start),
    var(--book-details-overlay-end)
  );
  backdrop-filter: blur(8px);
  content: '';
}

.book-details__backdrop :deep(.book-cover) {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  padding: 0;
}

.book-details__hero-content {
  position: relative;
  display: flex;
  gap: 20px;
  padding-top: 20px;
  padding-bottom: 12px;
}

.book-details__hero-content > :deep(.book-cover) {
  width: 160px;
  align-self: flex-start;
  flex: none;
  border-radius: 2px;
  box-shadow: var(--book-details-cover-shadow);
}

.book-details__hero-side {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.book-details__hero-copy {
  min-width: 0;
  padding-top: 8px;
}

.book-details__hero-shelf-actions {
  align-self: flex-end;
  flex: none;
  margin-top: auto;
}

.book-details__title {
  margin: 0 0 14px;
  font-size: clamp(18px, 2vw, 22px);
}

.book-details__hero-summary {
  display: grid;
  justify-items: start;
  gap: 4px;
}

.book-details__content {
  padding-top: 12px;
}

.book-details__primary-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.book-details__description {
  width: 100%;
  box-sizing: border-box;
  margin: 2px 0 22px;
  color: var(--n-text-color-2);
  line-height: 1.75;
  overflow-wrap: anywhere;
  white-space: normal;
}

.book-details__description :deep(:first-child) {
  margin-top: 0;
}

.book-details__description :deep(:last-child) {
  margin-bottom: 0;
}

.book-details__description :deep(p) {
  margin: 0;
}

.book-details__description :deep(li + li) {
  margin-top: 0.25em;
}

.book-details__reading-progress {
  flex: none;
  color: var(--book-details-summary-color);
  white-space: nowrap;
}

.book-details__info-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.book-details__info-button {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  color: var(--book-details-summary-color);
  background: transparent;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}

.book-details__info-button:is(:hover, :focus-visible, :active),
.book-details__edit-button:is(:hover, :focus-visible, :active) {
  color: var(--book-details-info-highlight-color);
}

.book-details__info-dialog {
  width: min(92vw, 680px);
}

.book-details__info-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  gap: 10px;
}

.book-details__info-item {
  display: grid;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
  gap: 5px;
  background: var(--n-color-embedded);
}

.book-details__info-item--wide {
  grid-column: 1 / -1;
}

.book-details__info-list dt {
  color: var(--n-text-color-3);
  font-size: 13px;
}

.book-details__info-list dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.book-details__return-to-shelf {
  flex: none;
  margin-left: auto;
}

.book-details__content :deep(.n-p) {
  margin: 12px 0;
}

.book-details__queue-hint {
  color: var(--n-text-color-3);
}

.book-details__settings {
  gap: 10px;
  margin: 4px 0 20px;
}
.book-details__setting-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
}

.book-details__settings :deep(.n-text) {
  width: 84px;
  flex: none;
}

.book-details__select {
  width: min(300px, 100%);
}

.book-details__volume-list {
  margin-top: 0;
}

.book-details__translation-header :deep(.n-h2) {
  margin: 0 0 4px;
}

.book-details__preferences-header :deep(.n-h2) {
  margin-bottom: 8px;
}

@media only screen and (min-width: 601px) {
  .book-details__preferences-header :deep(.n-h2) {
    margin-bottom: 12px;
  }
}

.book-details__translation-header {
  padding-top: 12px;
}

.book-details__queue-hint {
  margin: 12px 0 0;
  font-size: 13px;
}

.book-details__catalog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% + 8px);
  gap: 12px;
  margin: 0 -4px;
}

.book-details__catalog-close {
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.book-details__catalog-button {
  width: 100%;
  padding: 8px 0;
  text-align: left;
}

.book-details__catalog-button :deep(.n-button__content) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  width: 100%;
  gap: 10px;
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

@media only screen and (max-width: 600px) {
  .book-details__info-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .book-details__info-item--wide {
    grid-column: auto;
  }

  .book-details__primary-actions {
    align-items: center;
    flex-direction: row;
  }

  .book-details__primary-actions > :deep(.n-flex) {
    flex: 1;
    min-width: 0;
  }

  .book-details__hero-content {
    gap: 14px;
  }

  .book-details__hero-content > :deep(.book-cover) {
    width: min(160px, 40vw);
  }

  .book-details__hero-side,
  .book-details__hero-copy {
    min-width: 0;
    padding-top: 0;
  }

  .book-details__title b {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .book-details__hero-shelf-actions {
    align-self: stretch;
    flex-wrap: wrap !important;
    justify-content: flex-end;
  }

  .book-details__setting-row {
    align-items: stretch;
    flex-direction: column;
    gap: 4px;
  }

  .book-details__settings :deep(.n-text),
  .book-details__select {
    width: 100%;
  }
}
</style>
