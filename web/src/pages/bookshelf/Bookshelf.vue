<script lang="ts" setup>
import { useRouter } from 'vue-router';

import {
  filterAndSortBookshelf,
  type BookshelfDisplayBook,
  type BookshelfFilter,
  type BookshelfSort,
} from './BookshelfPresentation';
import {
  createBookshelfService,
  type BookshelfEntry,
} from './BookshelfService';
import BookCard from './components/BookCard.vue';

import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import { useLocalVolumeStore } from '@/stores';
import { useRuntimePanel } from '@/util/useRuntimePanel';

const router = useRouter();
const books = ref<BookshelfEntry[]>([]);
const loading = ref(true);
const error = ref<string>();
const query = ref('');
const filter = ref<BookshelfFilter>('all');
const sort = ref<BookshelfSort>('recent-read');
const showLocalVolumes = ref(false);
const unlistedBookIds = ref<string[]>([]);
const localSelectedBookIds = ref(new Set<string>());
const addingLocalBooks = ref(false);
const selectionMode = ref(false);
const selectedBookIds = ref(new Set<string>());
const batchUpdating = ref(false);
const message = useMessage();
const { html: infoPanelHtml } = useRuntimePanel('html/info-bookshelf.html');

const filterOptions: { label: string; value: BookshelfFilter }[] = [
  { label: '全部状态', value: 'all' },
  { label: '未开始', value: 'unread' },
  { label: '阅读中', value: 'reading' },
  { label: '已译完', value: 'translated' },
  { label: '未翻译', value: 'untranslated' },
];

const sortOptions: { label: string; value: BookshelfSort }[] = [
  { label: '最近阅读', value: 'recent-read' },
  { label: '最近添加', value: 'added' },
  { label: '标题', value: 'title' },
  { label: '阅读进度', value: 'reading-progress' },
  { label: '翻译进度', value: 'translation-progress' },
];

const visibleBooks = computed(() =>
  filterAndSortBookshelf(books.value, {
    query: query.value,
    filter: filter.value,
    sort: sort.value,
  }),
);
const selectedBook = computed(() => {
  if (selectedBookIds.value.size !== 1) return undefined;
  const [selectedBookId] = selectedBookIds.value;
  return books.value.find((book) => book.volume.id === selectedBookId);
});

const reload = async () => {
  loading.value = true;
  error.value = undefined;
  try {
    const repository = await useLocalVolumeStore();
    const service = createBookshelfService(repository);
    books.value = await service.list();
    unlistedBookIds.value = (await service.listUnlisted()).map(
      (entry) => entry.volume.id,
    );
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法加载书架';
  } finally {
    loading.value = false;
  }
};

const addLocalBook = async (bookId: string) => {
  const repository = await useLocalVolumeStore();
  await createBookshelfService(repository).setListed(bookId, true);
  showLocalVolumes.value = false;
  await reload();
};

const toggleLocalBookSelection = (bookId: string) => {
  const selected = new Set(localSelectedBookIds.value);
  if (selected.has(bookId)) selected.delete(bookId);
  else selected.add(bookId);
  localSelectedBookIds.value = selected;
};

const selectAllLocalBooks = (volumes: LocalVolumeMetadata[]) => {
  localSelectedBookIds.value = new Set(volumes.map((volume) => volume.id));
};

const invertLocalBookSelection = (volumes: LocalVolumeMetadata[]) => {
  const selected = new Set(localSelectedBookIds.value);
  volumes.forEach((volume) => {
    if (selected.has(volume.id)) selected.delete(volume.id);
    else selected.add(volume.id);
  });
  localSelectedBookIds.value = selected;
};

const addSelectedLocalBooks = async () => {
  const ids = [...localSelectedBookIds.value];
  if (ids.length === 0) return;
  addingLocalBooks.value = true;
  try {
    const repository = await useLocalVolumeStore();
    const service = createBookshelfService(repository);
    await Promise.all(ids.map((id) => service.setListed(id, true)));
    message.success(`已将 ${ids.length} 本书加入书架`);
    localSelectedBookIds.value = new Set();
    showLocalVolumes.value = false;
    await reload();
  } catch (reason) {
    message.error(`加入书架失败：${String(reason)}`);
  } finally {
    addingLocalBooks.value = false;
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

const updateSelectedBooks = async (action: 'pin' | 'unpin' | 'remove') => {
  const ids = [...selectedBookIds.value];
  if (ids.length === 0) return;
  batchUpdating.value = true;
  try {
    const repository = await useLocalVolumeStore();
    const service = createBookshelfService(repository);
    await Promise.all(
      ids.map((id) =>
        action === 'remove'
          ? service.setListed(id, false)
          : service.setPinned(id, action === 'pin'),
      ),
    );
    message.success(
      action === 'pin'
        ? `已置顶 ${ids.length} 本书`
        : action === 'unpin'
          ? `已取消置顶 ${ids.length} 本书`
          : `已将 ${ids.length} 本书移出书架`,
    );
    selectionMode.value = false;
    selectedBookIds.value = new Set();
    await reload();
  } catch (reason) {
    message.error(
      `${action === 'pin' ? '置顶' : action === 'unpin' ? '取消置顶' : '移出书架'}失败：${String(reason)}`,
    );
  } finally {
    batchUpdating.value = false;
  }
};

const resetFilters = () => {
  query.value = '';
  filter.value = 'all';
};

watch(showLocalVolumes, (show) => {
  if (!show) localSelectedBookIds.value = new Set();
});
onMounted(reload);
</script>

<template>
  <main class="layout-content bookshelf-page">
    <header class="bookshelf-page__header">
      <h1>书架</h1>
      <div class="bookshelf-page__header-actions">
        <n-button
          :type="selectionMode ? 'primary' : 'default'"
          @click="toggleSelectionMode"
        >
          {{ selectionMode ? '取消选择' : '选择' }}
        </n-button>
        <n-button @click="showLocalVolumes = true">从本地书架添加</n-button>
      </div>
      <bulletin v-if="infoPanelHtml" class="bookshelf-page__notice">
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
        <n-button size="small" @click="selectAllVisible">全选</n-button>
        <n-button size="small" @click="invertVisibleSelection">反选</n-button>
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
        <n-popconfirm
          :disabled="selectedBookIds.size === 0"
          @positive-click="updateSelectedBooks('remove')"
        >
          <template #trigger>
            <n-button
              size="small"
              type="warning"
              :disabled="selectedBookIds.size === 0"
              :loading="batchUpdating"
            >
              移出书架
            </n-button>
          </template>
          确定将所选书籍移出书架吗？
        </n-popconfirm>
      </div>

      <div class="bookshelf-toolbar">
        <n-input
          v-model:value="query"
          class="bookshelf-toolbar__search"
          clearable
          placeholder="搜索书名"
        />
        <n-select
          v-model:value="filter"
          class="bookshelf-toolbar__filter"
          :options="filterOptions"
        />
        <n-select
          v-model:value="sort"
          class="bookshelf-toolbar__sort"
          :options="sortOptions"
        />
      </div>

      <n-empty v-if="books.length === 0" description="书架中还没有书籍">
        <template #extra>
          <n-space>
            <n-button @click="showLocalVolumes = true">从本地书架添加</n-button>
          </n-space>
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
      <local-volume-list
        v-model:show="showLocalVolumes"
        :filter="(volume) => unlistedBookIds.includes(volume.id)"
        :show-management="false"
      >
        <template #extra="{ volumes }">
          <n-flex align="center" :wrap="true">
            <n-text>已选择 {{ localSelectedBookIds.size }} 本</n-text>
            <n-button size="small" @click="selectAllLocalBooks(volumes)">
              全选
            </n-button>
            <n-button size="small" @click="invertLocalBookSelection(volumes)">
              反选
            </n-button>
            <n-button
              size="small"
              type="primary"
              :disabled="localSelectedBookIds.size === 0"
              :loading="addingLocalBooks"
              @click="addSelectedLocalBooks"
            >
              加入书架
            </n-button>
          </n-flex>
        </template>
        <template #volume="volume">
          <n-flex align="center" justify="space-between" :wrap="false">
            <n-flex align="center" :wrap="false">
              <n-checkbox
                :checked="localSelectedBookIds.has(volume.id)"
                :aria-label="`选择 ${volume.id}`"
                @update:checked="toggleLocalBookSelection(volume.id)"
              />
              <n-flex vertical :size="2">
                <n-text>{{ volume.id }}</n-text>
                <n-text depth="3">共 {{ volume.toc.length }} 章</n-text>
              </n-flex>
            </n-flex>
            <n-button
              size="small"
              type="primary"
              @click="addLocalBook(volume.id)"
            >
              加入书架
            </n-button>
          </n-flex>
        </template>
      </local-volume-list>
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

  .bookshelf-toolbar__filter {
    grid-row: 2;
    grid-column: 1;
  }

  .bookshelf-toolbar__sort {
    grid-row: 2;
    grid-column: 2;
  }
}
</style>
