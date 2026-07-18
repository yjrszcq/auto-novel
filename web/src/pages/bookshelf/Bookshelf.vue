<script lang="ts" setup>
import { useRouter } from 'vue-router';

import {
  filterAndSortBookshelf,
  type BookshelfDisplayBook,
  type BookshelfReadingFilter,
  type BookshelfSort,
  type BookshelfTranslationFilter,
  type BookshelfTranslatorFilter,
} from './BookshelfPresentation';
import {
  createBookshelfService,
  type BookshelfEntry,
} from './BookshelfService';
import BookCard from './components/BookCard.vue';

import { useLocalVolumeManager } from '@/pages/workspace/LocalVolumeManager';
import { useLocalVolumeStore } from '@/stores';
import { useRuntimePanel } from '@/util/useRuntimePanel';

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
    hideSearch?: boolean;
    hideNotice?: boolean;
  }>(),
  {
    embedded: false,
    hideSearch: false,
    hideNotice: false,
  },
);
const query = defineModel<string>('query', { default: '' });
const router = useRouter();
const books = ref<BookshelfEntry[]>([]);
const loading = ref(true);
const error = ref<string>();
const readingFilter = ref<BookshelfReadingFilter>();
const translationFilter = ref<BookshelfTranslationFilter>();
const translatorFilter = ref<BookshelfTranslatorFilter>();
const showFilterPanel = ref(false);
const sort = ref<BookshelfSort>('recent-read');
const selectionMode = ref(false);
const selectedBookIds = ref(new Set<string>());
const batchUpdating = ref(false);
const downloadingSelectedBooks = ref(false);
const message = useMessage();
const localVolumeManager = useLocalVolumeManager();
const { html: infoPanelHtml } = useRuntimePanel('html/info-bookshelf.html');

const sortOptions: { label: string; value: BookshelfSort }[] = [
  { label: '最近阅读', value: 'recent-read' },
  { label: '最近添加', value: 'added' },
  { label: '书籍标题', value: 'title' },
  { label: '阅读进度', value: 'reading-progress' },
  { label: '翻译进度', value: 'translation-progress' },
];

const visibleBooks = computed(() =>
  filterAndSortBookshelf(books.value, {
    query: query.value,
    readingFilter: readingFilter.value,
    translationFilter: translationFilter.value,
    translatorFilter: translatorFilter.value,
    sort: sort.value,
  }),
);
const hasActiveFilters = computed(
  () =>
    readingFilter.value !== undefined ||
    translationFilter.value !== undefined ||
    translatorFilter.value !== undefined,
);
const filterButtonActive = computed(
  () => showFilterPanel.value || hasActiveFilters.value,
);
const selectedBook = computed(() => {
  if (selectedBookIds.value.size !== 1) return undefined;
  const [selectedBookId] = selectedBookIds.value;
  return books.value.find((book) => book.volume.id === selectedBookId);
});
const allVisibleBooksSelected = computed(
  () =>
    visibleBooks.value.length > 0 &&
    visibleBooks.value.every((book) =>
      selectedBookIds.value.has(book.volume.id),
    ),
);

const reload = async () => {
  loading.value = true;
  error.value = undefined;
  try {
    const repository = await useLocalVolumeStore();
    const service = createBookshelfService(repository);
    books.value = await service.list();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法加载书架';
  } finally {
    loading.value = false;
  }
};

const openDetails = (book: BookshelfDisplayBook) => {
  void router.push('/books/' + encodeURIComponent(book.volume.id) + '/details');
};

const toggleSelectionMode = () => {
  selectionMode.value = !selectionMode.value;
  selectedBookIds.value = new Set();
};

const toggleBookSelection = (book: BookshelfDisplayBook) => {
  if (!selectionMode.value) {
    openDetails(book);
    return;
  }
  const selected = new Set(selectedBookIds.value);
  if (selected.has(book.volume.id)) selected.delete(book.volume.id);
  else selected.add(book.volume.id);
  selectedBookIds.value = selected;
};

const selectAllVisible = () => {
  selectedBookIds.value = new Set(
    visibleBooks.value.map((book) => book.volume.id),
  );
};

const invertVisibleSelection = () => {
  const selected = new Set(selectedBookIds.value);
  visibleBooks.value.forEach((book) => {
    if (selected.has(book.volume.id)) selected.delete(book.volume.id);
    else selected.add(book.volume.id);
  });
  selectedBookIds.value = selected;
};

const toggleVisibleSelection = () => {
  if (allVisibleBooksSelected.value) invertVisibleSelection();
  else selectAllVisible();
};

const downloadSelectedBooks = async () => {
  const ids = [...selectedBookIds.value];
  if (ids.length === 0) return;
  downloadingSelectedBooks.value = true;
  try {
    const { success, failed } =
      await useLocalVolumeManager().downloadVolumes(ids);
    message.info(`${success}本小说已下载，${failed}本失败`);
  } finally {
    downloadingSelectedBooks.value = false;
  }
};

const queueSelectedBooks = (type: 'gpt' | 'sakura') => {
  const { success, failed } = localVolumeManager.queueJobsToWorkspace(
    [...selectedBookIds.value],
    {
      level: 'all',
      type,
      shouldTop: false,
    },
  );
  message.info(`${success}本小说已排队，${failed}本失败`);
};

const updateSelectedBooks = async (action: 'pin' | 'unpin' | 'delete') => {
  const ids = [...selectedBookIds.value];
  if (ids.length === 0) return;
  batchUpdating.value = true;
  try {
    if (action === 'delete') {
      const { success, failed } = await localVolumeManager.deleteVolumes(ids);
      message.info(`${success} 本书已删除，${failed} 本删除失败`);
    } else {
      const repository = await useLocalVolumeStore();
      const service = createBookshelfService(repository);
      await Promise.all(
        ids.map((id) => service.setPinned(id, action === 'pin')),
      );
      message.success(
        action === 'pin'
          ? `已置顶 ${ids.length} 本书`
          : `已取消置顶 ${ids.length} 本书`,
      );
    }
    selectionMode.value = false;
    selectedBookIds.value = new Set();
    await reload();
  } catch (reason) {
    message.error(
      `${action === 'pin' ? '置顶' : action === 'unpin' ? '取消置顶' : '删除书籍'}失败：${String(reason)}`,
    );
  } finally {
    batchUpdating.value = false;
  }
};

const clearStatusFilters = () => {
  readingFilter.value = undefined;
  translationFilter.value = undefined;
  translatorFilter.value = undefined;
};

const resetFilters = () => {
  query.value = '';
  clearStatusFilters();
};

const handleFilterButtonClick = () => {
  if (filterButtonActive.value) {
    clearStatusFilters();
    showFilterPanel.value = false;
    return;
  }
  showFilterPanel.value = true;
};

const setReadingFilter = (value?: BookshelfReadingFilter) => {
  readingFilter.value = value;
};

const setTranslationFilter = (value?: BookshelfTranslationFilter) => {
  translationFilter.value = value;
};

const setTranslatorFilter = (value?: BookshelfTranslatorFilter) => {
  translatorFilter.value = value;
};

onMounted(reload);
</script>

<template>
  <main
    class="bookshelf-page"
    :class="{
      'layout-content': !props.embedded,
      'bookshelf-page--embedded': props.embedded,
    }"
  >
    <header class="bookshelf-page__header">
      <h1 v-if="!props.embedded">书架</h1>
      <div class="bookshelf-page__header-actions">
        <n-button
          :type="selectionMode ? 'primary' : 'default'"
          @click="toggleSelectionMode"
        >
          {{ selectionMode ? '取消选择' : '选择' }}
        </n-button>
        <local-volume-upload-button @done="reload" />
        <c-button label="刷新" @action="reload" />
      </div>
      <bulletin
        v-if="!props.hideNotice && infoPanelHtml"
        class="bookshelf-page__notice"
      >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-html="infoPanelHtml" />
      </bulletin>
    </header>

    <n-skeleton v-if="loading" text :repeat="8" />

    <n-alert v-else-if="error" title="书架加载失败" type="error">
      {{ error }}
    </n-alert>

    <template v-else>
      <div v-if="selectionMode" class="bookshelf-selection-toolbar">
        <n-text>已选择 {{ selectedBookIds.size }} 本</n-text>
        <n-button
          v-if="selectedBook && !selectedBook.state.pinned"
          size="small"
          :loading="batchUpdating"
          @click="updateSelectedBooks('pin')"
        >
          置顶
        </n-button>
        <n-button
          v-if="selectedBook?.state.pinned"
          size="small"
          :loading="batchUpdating"
          @click="updateSelectedBooks('unpin')"
        >
          取消置顶
        </n-button>
        <n-button size="small" @click="toggleVisibleSelection">
          {{ allVisibleBooksSelected ? '反选' : '全选' }}
        </n-button>
        <n-button
          size="small"
          :disabled="selectedBookIds.size === 0"
          @click="queueSelectedBooks('gpt')"
        >
          排队 GPT
        </n-button>
        <n-button
          size="small"
          :disabled="selectedBookIds.size === 0"
          @click="queueSelectedBooks('sakura')"
        >
          排队 Sakura
        </n-button>
        <n-button
          size="small"
          :disabled="selectedBookIds.size === 0"
          :loading="downloadingSelectedBooks"
          @click="downloadSelectedBooks"
        >
          下载
        </n-button>
        <n-popconfirm
          :disabled="selectedBookIds.size === 0"
          @positive-click="updateSelectedBooks('delete')"
        >
          <template #trigger>
            <n-button
              size="small"
              type="warning"
              :disabled="selectedBookIds.size === 0"
              :loading="batchUpdating"
            >
              删除书籍
            </n-button>
          </template>
          确定永久删除所选书籍及其阅读数据吗？此操作无法恢复。
        </n-popconfirm>
      </div>

      <div
        class="bookshelf-toolbar"
        :class="{
          'bookshelf-toolbar--without-search': props.hideSearch,
        }"
      >
        <n-input
          v-if="!props.hideSearch"
          v-model:value="query"
          class="bookshelf-toolbar__search"
          clearable
          placeholder="搜索书名"
        />
        <n-button
          class="bookshelf-toolbar__filter"
          :type="filterButtonActive ? 'primary' : 'default'"
          aria-label="书架筛选"
          :aria-pressed="filterButtonActive"
          @click="handleFilterButtonClick"
        >
          {{ filterButtonActive ? '取消筛选' : '筛选' }}
        </n-button>
        <n-select
          v-model:value="sort"
          class="bookshelf-toolbar__sort"
          :options="sortOptions"
        />
      </div>

      <div v-show="showFilterPanel" class="bookshelf-filter-panel">
        <div class="bookshelf-filter-panel__group">
          <n-text depth="3">阅读状态</n-text>
          <n-space>
            <n-button
              text
              :type="readingFilter === undefined ? 'primary' : 'default'"
              :aria-pressed="readingFilter === undefined"
              @click="setReadingFilter()"
            >
              全部
            </n-button>
            <n-button
              text
              :type="readingFilter === 'unread' ? 'primary' : 'default'"
              :aria-pressed="readingFilter === 'unread'"
              @click="setReadingFilter('unread')"
            >
              未开始
            </n-button>
            <n-button
              text
              :type="readingFilter === 'reading' ? 'primary' : 'default'"
              :aria-pressed="readingFilter === 'reading'"
              @click="setReadingFilter('reading')"
            >
              阅读中
            </n-button>
          </n-space>
        </div>
        <div class="bookshelf-filter-panel__group">
          <n-text depth="3">翻译状态</n-text>
          <n-space>
            <n-button
              text
              :type="translationFilter === undefined ? 'primary' : 'default'"
              :aria-pressed="translationFilter === undefined"
              @click="setTranslationFilter()"
            >
              全部
            </n-button>
            <n-button
              text
              :type="translationFilter === 'translated' ? 'primary' : 'default'"
              :aria-pressed="translationFilter === 'translated'"
              @click="setTranslationFilter('translated')"
            >
              已译完
            </n-button>
            <n-button
              text
              :type="
                translationFilter === 'untranslated' ? 'primary' : 'default'
              "
              :aria-pressed="translationFilter === 'untranslated'"
              @click="setTranslationFilter('untranslated')"
            >
              未翻译
            </n-button>
          </n-space>
        </div>
        <div class="bookshelf-filter-panel__group">
          <n-text depth="3">翻译</n-text>
          <n-space>
            <n-button
              text
              :type="translatorFilter === undefined ? 'primary' : 'default'"
              :aria-pressed="translatorFilter === undefined"
              @click="setTranslatorFilter()"
            >
              全部
            </n-button>
            <n-button
              text
              :type="translatorFilter === 'gpt' ? 'primary' : 'default'"
              :aria-pressed="translatorFilter === 'gpt'"
              @click="setTranslatorFilter('gpt')"
            >
              GPT
            </n-button>
            <n-button
              text
              :type="translatorFilter === 'sakura' ? 'primary' : 'default'"
              :aria-pressed="translatorFilter === 'sakura'"
              @click="setTranslatorFilter('sakura')"
            >
              Sakura
            </n-button>
          </n-space>
        </div>
      </div>

      <n-empty v-if="books.length === 0" description="还没有本地书籍">
        <template #extra>
          <local-volume-upload-button @done="reload" />
        </template>
      </n-empty>

      <n-empty
        v-else-if="visibleBooks.length === 0"
        description="没有符合当前筛选条件的书籍"
      >
        <template #extra>
          <n-button @click="resetFilters">清除筛选</n-button>
        </template>
      </n-empty>

      <section v-else class="book-grid" aria-label="书架书籍列表">
        <BookCard
          v-for="book in visibleBooks"
          :key="book.volume.id"
          :book="book"
          :selectable="selectionMode"
          :selected="selectedBookIds.has(book.volume.id)"
          @details="toggleBookSelection"
          @toggle-selection="toggleBookSelection"
        />
      </section>
    </template>
  </main>
</template>

<style scoped>
.bookshelf-page {
  padding-top: 28px;
}

.bookshelf-page__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 24px;
}

.bookshelf-page--embedded {
  padding-top: 0;
}

.bookshelf-page--embedded .bookshelf-page__header {
  justify-content: end;
  margin-bottom: 8px;
}

.bookshelf-page__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bookshelf-page h1 {
  margin: 0;
}

.bookshelf-page__notice {
  grid-column: 1 / -1;
}

.bookshelf-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(132px, 0.4fr) minmax(
      132px,
      0.4fr
    );
  gap: 10px;
  margin-bottom: 18px;
}

.bookshelf-toolbar--without-search {
  grid-template-columns: repeat(2, minmax(132px, 220px));
}

.bookshelf-toolbar__filter {
  width: 100%;
}

.bookshelf-filter-panel {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  margin: -8px 0 18px;
  border: 1px solid var(--n-border-color);
  border-radius: var(--n-border-radius);
  background: var(--n-card-color);
}

.bookshelf-filter-panel__group {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.bookshelf-selection-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--n-border-color);
  border-radius: var(--n-border-radius);
  background: var(--n-card-color);
}

.bookshelf-selection-toolbar > :first-child {
  margin-right: auto;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media only screen and (min-width: 680px) {
  .book-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media only screen and (min-width: 1000px) {
  .book-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media only screen and (min-width: 1440px) {
  .book-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

@media only screen and (max-width: 600px) {
  .bookshelf-page__header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .bookshelf-page__header-actions {
    margin-left: auto;
  }

  .bookshelf-page__header-actions :deep(.n-button) {
    padding-inline: 10px;
  }

  .bookshelf-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .bookshelf-toolbar__search {
    grid-row: 1;
    grid-column: 1 / -1;
  }

  .bookshelf-toolbar--without-search {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .bookshelf-toolbar__filter {
    grid-row: 2;
    grid-column: 1;
  }

  .bookshelf-toolbar__sort {
    grid-row: 2;
    grid-column: 2;
  }

  .bookshelf-filter-panel {
    padding-inline: 12px;
  }

  .bookshelf-filter-panel__group {
    grid-template-columns: 72px minmax(0, 1fr);
  }
}
</style>
