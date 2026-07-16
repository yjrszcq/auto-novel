<script lang="ts" setup>
import type {
  ReaderBook,
  ReaderBookStyleOverride,
  ReaderChapterSummary,
  ReaderProgress,
  ReaderReadingStats,
} from '@/model/Reader';
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
  readerModes,
  type SelectableReaderMode,
} from '../reader/core/ReaderMode';
import {
  searchReaderChapters,
  type ReaderSearchResult,
} from '../reader/core/ReaderSearch';
import { formatReadingDuration } from '../reader/core/ReaderStats';

import { useLocalVolumeStore } from '@/stores';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const loading = ref(true);
const error = ref<string>();
const book = shallowRef<ReaderBook>();
const bookTheme = ref<'global' | NonNullable<ReaderBookStyleOverride['theme']>>(
  'global',
);
const searchQuery = ref('');
const searchResults = ref<ReaderSearchResult[]>([]);
const searching = ref(false);
const entry = shallowRef<BookshelfEntry>();
const chapters = ref<ReaderChapterSummary[]>([]);
const progress = shallowRef<ReaderProgress>();
const readingStats = shallowRef<ReaderReadingStats>();
const bookmarkCount = ref(0);
const preferredMode = ref<'global' | SelectableReaderMode>('global');
const coverInput = ref<HTMLInputElement>();
const coverVersion = ref(0);
const repositoryPromise = useLocalVolumeStore();

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
  ({
    global: '跟随全局设置',
    translated: '译文',
    'translated-original': '译文-原文',
    'original-translated': '原文-译文',
    original: '原文',
  })[mode];

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

const searchBook = async () => {
  const query = searchQuery.value.trim();
  if (query.length === 0) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  try {
    const repository = await repositoryPromise;
    const adapter = createLocalVolumeReaderAdapter(repository);
    const contents = await Promise.all(
      chapters.value.map((chapter) =>
        adapter.getChapter({ bookId: bookId.value, chapterId: chapter.id }),
      ),
    );
    searchResults.value = searchReaderChapters(contents, query);
  } finally {
    searching.value = false;
  }
};

const openSearchResult = (result: ReaderSearchResult) => {
  void router.push({
    path:
      '/books/' +
      encodeURIComponent(bookId.value) +
      '/read/' +
      encodeURIComponent(result.chapterId),
    query: { segment: result.segmentId },
  });
};

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
    updatedAt: Date.now(),
  });
  coverVersion.value += 1;
  message.success('封面已保存到当前浏览器');
};

const removeCover = async () => {
  const repository = await repositoryPromise;
  await repository.deleteReaderCover(bookId.value);
  coverVersion.value += 1;
  message.success('已移除自定义封面');
};

onMounted(() => void load());
</script>

<template>
  <main class="layout-content book-details">
    <header class="book-details__header">
      <div>
        <h1>书籍详情</h1>
        <p>书籍、封面与阅读数据仅保存在当前浏览器。</p>
      </div>
      <n-button @click="router.push('/bookshelf')">返回书架</n-button>
    </header>

    <n-spin v-if="loading" size="large" />
    <n-alert v-else-if="error !== undefined" title="无法加载书籍" type="error">
      {{ error }}
    </n-alert>

    <template v-else-if="book !== undefined && entry !== undefined">
      <n-card>
        <div class="book-details__summary">
          <BookCover
            :book-id="book.id"
            :refresh-key="coverVersion"
            :title="book.title"
          />
          <div class="book-details__metadata">
            <h2>{{ book.title }}</h2>
            <dl>
              <div>
                <dt>章节</dt>
                <dd>{{ book.chapterCount }}</dd>
              </div>
              <div>
                <dt>语言</dt>
                <dd>{{ book.sourceLanguage }} → {{ book.targetLanguage }}</dd>
              </div>
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
            <n-button type="primary" @click="startReading">
              {{ progress === undefined ? '开始阅读' : '继续阅读' }}
            </n-button>
          </div>
        </div>
      </n-card>

      <n-card title="阅读与翻译进度" class="book-details__card">
        <div class="book-details__progress">
          <div>
            <span>阅读 {{ Math.round(readingProgress) }}%</span>
            <n-progress :percentage="Math.round(readingProgress)" />
          </div>
          <div>
            <span>翻译 {{ Math.round(translationProgress) }}%</span>
            <n-progress
              :percentage="Math.round(translationProgress)"
              type="info"
            />
          </div>
        </div>
        <p>已完整翻译 {{ completedChapters }} / {{ chapters.length }} 章。</p>
      </n-card>

      <n-card title="本书阅读偏好" class="book-details__card">
        <n-form label-placement="top">
          <n-form-item label="默认打开方式">
            <n-select
              :value="preferredMode"
              :options="[
                { label: modeLabel('global'), value: 'global' },
                ...readerModes.map((mode) => ({
                  label: modeLabel(mode),
                  value: mode,
                })),
              ]"
              @update:value="savePreference"
            />
          </n-form-item>
          <n-form-item label="本书主题覆盖">
            <n-select
              :value="bookTheme"
              :options="[
                { label: '跟随全局设置', value: 'global' },
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' },
                { label: '护眼', value: 'sepia' },
                { label: '跟随系统', value: 'system' },
              ]"
              @update:value="saveBookTheme"
            />
          </n-form-item>
        </n-form>
      </n-card>

      <n-card title="本地全文检索" class="book-details__card">
        <n-input-group>
          <n-input
            v-model:value="searchQuery"
            placeholder="搜索已导入的原文或译文"
            @keyup.enter="searchBook"
          />
          <n-button :loading="searching" type="primary" @click="searchBook">
            搜索
          </n-button>
        </n-input-group>
        <n-empty
          v-if="
            searchQuery.trim().length > 0 &&
            !searching &&
            searchResults.length === 0
          "
          description="没有本地匹配结果"
        />
        <n-list v-else-if="searchResults.length > 0" hoverable clickable>
          <n-list-item
            v-for="result in searchResults"
            :key="result.chapterId + result.segmentId + result.languageSide"
            @click="openSearchResult(result)"
          >
            <n-thing
              :title="result.chapterTitle"
              :description="result.excerpt"
            />
          </n-list-item>
        </n-list>
      </n-card>

      <n-card title="封面与书架" class="book-details__card">
        <input
          ref="coverInput"
          accept="image/*"
          hidden
          type="file"
          @change="updateCover"
        />
        <n-space>
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
    </template>
  </main>
</template>

<style scoped>
.book-details {
  padding-top: 28px;
}

.book-details__header,
.book-details__summary {
  display: flex;
  gap: 20px;
}

.book-details__header {
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.book-details__header h1,
.book-details__header p,
.book-details__metadata h2,
.book-details__card p {
  margin: 0;
}

.book-details__header p,
.book-details__card p {
  margin-top: 8px;
  color: var(--n-text-color-3);
}

.book-details__summary :deep(.book-cover) {
  width: min(180px, 36vw);
  flex: none;
}

.book-details__metadata {
  min-width: 0;
}

.book-details__metadata dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  margin: 18px 0;
}

.book-details__metadata dl div {
  display: grid;
  gap: 2px;
}

.book-details__metadata dt {
  color: var(--n-text-color-3);
  font-size: 12px;
}

.book-details__metadata dd {
  margin: 0;
}

.book-details__card {
  margin-top: 16px;
}

.book-details__progress {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.book-details__progress > div {
  display: grid;
  gap: 8px;
}

@media only screen and (max-width: 600px) {
  .book-details__header,
  .book-details__summary {
    align-items: stretch;
    flex-direction: column;
  }

  .book-details__summary :deep(.book-cover) {
    width: min(180px, 60vw);
  }

  .book-details__metadata dl,
  .book-details__progress {
    grid-template-columns: 1fr;
  }
}
</style>
