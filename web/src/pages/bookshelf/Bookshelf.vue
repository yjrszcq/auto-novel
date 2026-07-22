<script lang="ts" setup>
import {
  ChecklistOutlined,
  FilterAltOutlined,
  RefreshOutlined,
} from '@vicons/material';
import type { DropdownMixedOption } from 'naive-ui';
import { useRouter } from 'vue-router';

import { shouldEmbedDownloadMetadata } from '@/model/LocalVolume';

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
import { useLocalVolumeStore, useSettingStore } from '@/stores';
import { downloadFile } from '@/util';

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
    hideSearch?: boolean;
  }>(),
  {
    embedded: false,
    hideSearch: false,
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
const contextMenuBook = shallowRef<BookshelfDisplayBook>();
const contextMenuShown = ref(false);
const contextMenuSession = ref(0);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextDeleteBook = shallowRef<BookshelfDisplayBook>();
const showContextDeleteConfirm = ref(false);
const deletingContextBook = ref(false);
const message = useMessage();
const localVolumeManager = useLocalVolumeManager();
const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

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

const translatedChapterCount = (
  book: BookshelfDisplayBook,
  type: 'gpt' | 'sakura',
) =>
  book.volume.toc.filter((chapter) => chapter[type] === book.volume.glossaryId)
    .length;

const renderContextProgress = (label: string, type: 'gpt' | 'sakura') => {
  const book = contextMenuBook.value;
  const completed = book === undefined ? 0 : translatedChapterCount(book, type);
  const total = book?.volume.toc.length ?? 0;
  return h('div', { class: 'bookshelf-book-context-progress' }, [
    h('span', label),
    h('span', `${completed}/${total}`),
  ]);
};

const contextMenuOptions = computed<DropdownMixedOption[]>(() => [
  { label: '阅读书籍', key: 'read' },
  {
    label: contextMenuBook.value?.state.pinned ? '取消置顶' : '置顶书籍',
    key: 'toggle-pin',
  },
  { label: '排队 GPT', key: 'queue-gpt' },
  { label: '排队 Sakura', key: 'queue-sakura' },
  { label: '下载译文', key: 'download-translated' },
  { label: '下载原文', key: 'download-original' },
  { label: '删除书籍', key: 'delete' },
  { type: 'divider', key: 'progress-divider' },
  {
    type: 'render',
    key: 'gpt-progress',
    render: () => renderContextProgress('GPT', 'gpt'),
  },
  {
    type: 'render',
    key: 'sakura-progress',
    render: () => renderContextProgress('Sakura', 'sakura'),
  },
]);

const contextMenuProps = () => ({
  class: 'bookshelf-book-context-menu',
});

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

const closeBookContextMenu = () => {
  contextMenuShown.value = false;
};

const openBookContextMenu = async (
  book: BookshelfDisplayBook,
  position: { x: number; y: number },
) => {
  contextMenuShown.value = false;
  await nextTick();
  contextMenuBook.value = book;
  contextMenuX.value = Math.min(Math.max(8, position.x), window.innerWidth - 8);
  contextMenuY.value = Math.min(
    Math.max(8, position.y),
    window.innerHeight - 8,
  );
  contextMenuSession.value += 1;
  contextMenuShown.value = true;
};

const readContextBook = (book: BookshelfDisplayBook) => {
  const chapterId = book.progress?.chapterId ?? book.volume.toc[0]?.chapterId;
  if (chapterId === undefined) {
    message.warning('这本书还没有可阅读章节');
    return;
  }
  const href = router.resolve(
    '/books/' +
      encodeURIComponent(book.volume.id) +
      '/read/' +
      encodeURIComponent(chapterId),
  ).href;
  window.open(href, '_blank', 'noopener');
};

const queueContextBook = (
  book: BookshelfDisplayBook,
  type: 'gpt' | 'sakura',
) => {
  const { success, failed } = localVolumeManager.queueJobsToWorkspace(
    [book.volume.id],
    {
      level: 'all',
      type,
      shouldTop: false,
    },
  );
  message.info(`${success}本小说已排队，${failed}本失败`);
};

const toggleContextBookPinned = async (book: BookshelfDisplayBook) => {
  try {
    const repository = await useLocalVolumeStore();
    const service = createBookshelfService(repository);
    const pinned = !book.state.pinned;
    await service.setPinned(book.volume.id, pinned);
    message.success(pinned ? '书籍已置顶' : '已取消置顶');
    await reload();
  } catch (reason) {
    message.error(`置顶书籍失败：${String(reason)}`);
  }
};

const downloadContextTranslation = async (book: BookshelfDisplayBook) => {
  const { success, failed } = await localVolumeManager.downloadVolumes([
    book.volume.id,
  ]);
  message.info(`${success}本小说已下载，${failed}本失败`);
};

const downloadContextOriginal = async (book: BookshelfDisplayBook) => {
  try {
    const repository = await useLocalVolumeStore();
    const file = await repository.getOriginalDownloadFile({
      id: book.volume.id,
      embedMetadata: shouldEmbedDownloadMetadata(
        book.volume,
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

const handleBookContextAction = async (key: string | number) => {
  const book = contextMenuBook.value;
  closeBookContextMenu();
  if (book === undefined) return;
  switch (key) {
    case 'read':
      readContextBook(book);
      break;
    case 'toggle-pin':
      await toggleContextBookPinned(book);
      break;
    case 'queue-gpt':
      queueContextBook(book, 'gpt');
      break;
    case 'queue-sakura':
      queueContextBook(book, 'sakura');
      break;
    case 'download-translated':
      await downloadContextTranslation(book);
      break;
    case 'download-original':
      await downloadContextOriginal(book);
      break;
    case 'delete':
      contextDeleteBook.value = book;
      showContextDeleteConfirm.value = true;
      break;
  }
};

const deleteContextBook = async () => {
  const book = contextDeleteBook.value;
  if (book === undefined) return;
  deletingContextBook.value = true;
  try {
    const { success, failed } = await localVolumeManager.deleteVolumes([
      book.volume.id,
    ]);
    message.info(`${success} 本书已删除，${failed} 本删除失败`);
    showContextDeleteConfirm.value = false;
    contextDeleteBook.value = undefined;
    await reload();
  } catch (reason) {
    message.error(`删除书籍失败：${String(reason)}`);
  } finally {
    deletingContextBook.value = false;
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
      'bookshelf-page--filter-open': showFilterPanel,
      'bookshelf-page--selection-mode': selectionMode,
    }"
  >
    <header class="bookshelf-page__header">
      <h1 v-if="!props.embedded">书架</h1>
      <div class="bookshelf-page__header-actions">
        <c-button
          label="筛选"
          :icon="FilterAltOutlined"
          class="bookshelf-header-filter"
          :type="filterButtonActive ? 'primary' : 'default'"
          aria-label="书架筛选"
          :aria-pressed="filterButtonActive"
          compact-on-mobile
          :round="false"
          @action="handleFilterButtonClick"
        />
        <c-button
          label="选择"
          :icon="ChecklistOutlined"
          :type="selectionMode ? 'primary' : 'default'"
          :aria-pressed="selectionMode"
          compact-on-mobile
          :round="false"
          @action="toggleSelectionMode"
        />
        <local-volume-upload-button
          compact-on-mobile
          :round="false"
          @done="reload"
        />
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
        <c-button
          label="刷新"
          :icon="RefreshOutlined"
          class="bookshelf-toolbar__refresh"
          compact-on-mobile
          :round="false"
          @action="reload"
        />
        <n-select
          v-model:value="sort"
          class="bookshelf-toolbar__sort"
          :options="sortOptions"
          :consistent-menu-width="false"
        />
      </div>
    </header>

    <n-skeleton v-if="loading" text :repeat="8" />

    <n-alert v-else-if="error" title="书架加载失败" type="error">
      {{ error }}
    </n-alert>

    <template v-else>
      <div v-if="selectionMode" class="bookshelf-selection-toolbar">
        <div class="bookshelf-selection-toolbar__selection">
          <n-button
            class="bookshelf-selection-toolbar__select-all"
            @click="toggleVisibleSelection"
          >
            {{ allVisibleBooksSelected ? '反选' : '全选' }}
          </n-button>
          <n-text class="bookshelf-selection-toolbar__summary">
            已选择 {{ selectedBookIds.size }} 本
          </n-text>
        </div>
        <div class="bookshelf-selection-toolbar__actions">
          <div class="bookshelf-selection-toolbar__pin-actions">
            <n-button
              v-if="selectedBook && !selectedBook.state.pinned"
              :loading="batchUpdating"
              @click="updateSelectedBooks('pin')"
            >
              置顶
            </n-button>
            <n-button
              v-if="selectedBook?.state.pinned"
              :loading="batchUpdating"
              @click="updateSelectedBooks('unpin')"
            >
              取消置顶
            </n-button>
          </div>
          <div class="bookshelf-selection-toolbar__queue-actions">
            <n-button
              :disabled="selectedBookIds.size === 0"
              @click="queueSelectedBooks('gpt')"
            >
              排队 GPT
            </n-button>
            <n-button
              :disabled="selectedBookIds.size === 0"
              @click="queueSelectedBooks('sakura')"
            >
              排队 Sakura
            </n-button>
          </div>
          <div class="bookshelf-selection-toolbar__file-actions">
            <n-button
              :disabled="selectedBookIds.size === 0"
              :loading="downloadingSelectedBooks"
              @click="downloadSelectedBooks"
            >
              下载
            </n-button>
            <n-popconfirm
              :disabled="selectedBookIds.size === 0"
              placement="top-end"
              style="max-width: 300px"
              @positive-click="updateSelectedBooks('delete')"
            >
              <template #trigger>
                <n-button
                  secondary
                  type="error"
                  :disabled="selectedBookIds.size === 0"
                  :loading="batchUpdating"
                >
                  删除
                </n-button>
              </template>
              确定永久删除所选书籍及其阅读数据吗？此操作无法恢复。
            </n-popconfirm>
          </div>
        </div>
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

      <n-empty
        v-if="books.length === 0"
        class="bookshelf-empty-state"
        description="还没有本地书籍"
      >
        <template #extra>
          <local-volume-upload-button
            :enable-drop-zone="false"
            :round="false"
            @done="reload"
          />
        </template>
      </n-empty>

      <n-empty
        v-else-if="visibleBooks.length === 0"
        class="bookshelf-empty-state"
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
          @context-menu="openBookContextMenu"
          @details="toggleBookSelection"
          @toggle-selection="toggleBookSelection"
        />
      </section>
    </template>

    <n-dropdown
      :key="contextMenuSession"
      trigger="manual"
      placement="bottom-start"
      :show="contextMenuShown"
      :x="contextMenuX"
      :y="contextMenuY"
      :options="contextMenuOptions"
      :menu-props="contextMenuProps"
      @clickoutside="closeBookContextMenu"
      @select="handleBookContextAction"
      @update:show="contextMenuShown = $event"
    />

    <n-modal
      v-model:show="showContextDeleteConfirm"
      preset="dialog"
      title="删除书籍"
      positive-text="删除"
      negative-text="取消"
      :positive-button-props="{
        loading: deletingContextBook,
        type: 'error',
      }"
      style="width: min(420px, calc(100vw - 24px))"
      @positive-click="deleteContextBook"
      @after-leave="contextDeleteBook = undefined"
    >
      确定永久删除《{{
        contextDeleteBook?.title
      }}》及其阅读数据吗？此操作无法恢复。
    </n-modal>
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
  padding-top: 12px;
}

.bookshelf-page--embedded .bookshelf-page__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.bookshelf-page--embedded.bookshelf-page--filter-open .bookshelf-page__header,
.bookshelf-page--embedded.bookshelf-page--selection-mode
  .bookshelf-page__header {
  margin-bottom: 6px;
}

.bookshelf-page__header-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
}

.bookshelf-page__header-actions :deep(.n-upload) {
  width: auto;
}

.bookshelf-page h1 {
  margin: 0;
}

.bookshelf-toolbar {
  display: grid;
  grid-column: 1 / -1;
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

.bookshelf-page--embedded .bookshelf-toolbar {
  flex: 0 0 auto;
  grid-template-columns: max-content 180px;
  margin: 0 0 0 auto;
}

.bookshelf-toolbar__refresh {
  justify-self: end;
}

.bookshelf-filter-panel {
  display: grid;
  gap: 8px;
  padding: 8px 16px;
  margin: 0 0 12px;
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
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
  border: 1px solid var(--n-border-color);
  border-radius: 10px;
  background: var(--n-card-color);
}

.bookshelf-page--filter-open .bookshelf-selection-toolbar {
  margin-bottom: 4px;
}

.bookshelf-selection-toolbar__selection {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 10px;
}

.bookshelf-selection-toolbar__summary {
  white-space: nowrap;
  font-weight: 500;
}

.bookshelf-selection-toolbar__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 10px;
}

.bookshelf-selection-toolbar__pin-actions,
.bookshelf-selection-toolbar__queue-actions,
.bookshelf-selection-toolbar__file-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

:global(.bookshelf-book-context-menu) {
  min-width: 190px;
  max-width: calc(100vw - 16px);
}

:global(.bookshelf-book-context-progress) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  min-width: 150px;
  padding: 6px 12px;
  opacity: 0.85;
}

.bookshelf-empty-state {
  padding-top: clamp(56px, 8vh, 88px);
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(max(140px, calc((100% - 60px) / 6)), 1fr)
  );
  gap: 12px;
}

@media only screen and (max-width: 600px) {
  .bookshelf-page__header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .bookshelf-page--embedded .bookshelf-page__header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px;
  }

  .bookshelf-page__header-actions {
    gap: 6px;
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

  .bookshelf-toolbar__refresh {
    grid-row: 2;
    grid-column: 1;
  }

  .bookshelf-toolbar__sort {
    grid-row: 2;
    grid-column: 2;
    min-width: 124px;
  }

  .bookshelf-page--embedded .bookshelf-toolbar {
    grid-column: auto;
    grid-template-columns: max-content minmax(0, 1fr);
  }

  .bookshelf-page--embedded .bookshelf-toolbar__refresh,
  .bookshelf-page--embedded .bookshelf-toolbar__sort {
    grid-row: auto;
  }

  .bookshelf-filter-panel {
    padding-inline: 12px;
  }

  .bookshelf-filter-panel__group {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .book-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .bookshelf-selection-toolbar {
    align-items: stretch;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 8px 10px;
  }

  .bookshelf-selection-toolbar__selection {
    grid-column: 1;
    grid-row: 1;
  }

  .bookshelf-selection-toolbar__actions {
    display: contents;
  }

  .bookshelf-selection-toolbar__pin-actions {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
  }

  .bookshelf-selection-toolbar__queue-actions {
    grid-column: 1;
    grid-row: 2;
    justify-self: start;
  }

  .bookshelf-selection-toolbar__file-actions {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
  }

  .bookshelf-selection-toolbar__pin-actions,
  .bookshelf-selection-toolbar__queue-actions,
  .bookshelf-selection-toolbar__file-actions {
    gap: 6px;
  }

  .bookshelf-selection-toolbar__actions .n-button {
    padding-inline: 8px;
  }
}
</style>
