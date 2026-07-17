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

const openDetails = (book: BookshelfDisplayBook) => {
  void router.push('/books/' + encodeURIComponent(book.volume.id) + '/details');
};

const resetFilters = () => {
  query.value = '';
  filter.value = 'all';
};

onMounted(reload);
</script>

<template>
  <main class="layout-content bookshelf-page">
    <header class="bookshelf-page__header">
      <h1>书架</h1>
      <div class="bookshelf-page__header-actions">
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
          @details="openDetails"
        />
      </section>
      <local-volume-list
        v-model:show="showLocalVolumes"
        :filter="(volume) => unlistedBookIds.includes(volume.id)"
        :show-management="false"
      >
        <template #volume="volume">
          <n-flex align="center" justify="space-between" :wrap="false">
            <n-flex vertical :size="2">
              <n-text>{{ volume.id }}</n-text>
              <n-text depth="3">共 {{ volume.toc.length }} 章</n-text>
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
  .bookshelf-page__header-actions {
    margin-left: auto;
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
