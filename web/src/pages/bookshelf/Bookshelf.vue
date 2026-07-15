<script lang="ts" setup>
import { useRouter } from 'vue-router';

import {
  filterAndSortBookshelf,
  getContinueReadingBook,
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

const router = useRouter();
const books = ref<BookshelfEntry[]>([]);
const loading = ref(true);
const error = ref<string>();
const query = ref('');
const filter = ref<BookshelfFilter>('all');
const sort = ref<BookshelfSort>('recent-read');

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
const continueBook = computed(() => getContinueReadingBook(books.value));

const reload = async () => {
  loading.value = true;
  error.value = undefined;
  try {
    const repository = await useLocalVolumeStore();
    books.value = await createBookshelfService(repository).list();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法加载书架';
  } finally {
    loading.value = false;
  }
};

const openBook = (book: BookshelfDisplayBook) => {
  const chapterId = book.progress?.chapterId ?? book.volume.toc[0]?.chapterId;
  if (chapterId === undefined) {
    void router.push('/workspace/toolbox');
    return;
  }
  void router.push(
    `/workspace/reader/${encodeURIComponent(book.volume.id)}/${encodeURIComponent(chapterId)}`,
  );
};

const openWorkspace = () => {
  void router.push('/workspace/toolbox');
};

const openDetails = (book: BookshelfDisplayBook) => {
  void router.push('/books/' + encodeURIComponent(book.volume.id) + '/details');
};

const removeBook = async (book: BookshelfDisplayBook) => {
  const repository = await useLocalVolumeStore();
  await createBookshelfService(repository).setListed(book.volume.id, false);
  await reload();
};

const togglePin = async (book: BookshelfDisplayBook) => {
  const repository = await useLocalVolumeStore();
  await createBookshelfService(repository).setPinned(
    book.volume.id,
    !book.state.pinned,
  );
  await reload();
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
      <div>
        <h1>书架</h1>
        <p>书籍和阅读数据仅保存在当前浏览器。</p>
      </div>
      <n-button @click="openWorkspace">前往工作区</n-button>
    </header>

    <n-skeleton v-if="loading" text :repeat="8" />

    <n-alert v-else-if="error" title="书架加载失败" type="error">
      {{ error }}
    </n-alert>

    <template v-else>
      <n-card v-if="continueBook !== undefined" class="continue-card">
        <template #header>继续阅读</template>
        <div class="continue-card__content">
          <div>
            <strong>{{ continueBook.title }}</strong>
            <p>
              阅读 {{ Math.round(continueBook.readingProgress) }}% · 翻译
              {{ Math.round(continueBook.translationProgress) }}%
            </p>
          </div>
          <n-button type="primary" @click="openBook(continueBook)">
            继续阅读
          </n-button>
        </div>
      </n-card>

      <div class="bookshelf-toolbar">
        <n-input v-model:value="query" clearable placeholder="搜索书名" />
        <n-select v-model:value="filter" :options="filterOptions" />
        <n-select v-model:value="sort" :options="sortOptions" />
      </div>

      <n-empty v-if="books.length === 0" description="书架中还没有书籍">
        <template #extra>
          <n-button type="primary" @click="openWorkspace">
            前往工作区导入
          </n-button>
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
          @continue="openBook"
          @workspace="openWorkspace"
          @details="openDetails"
          @pin="togglePin"
          @remove="removeBook"
        />
      </section>
    </template>
  </main>
</template>

<style scoped>
.bookshelf-page {
  padding-top: 28px;
}

.bookshelf-page__header,
.continue-card__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.bookshelf-page__header {
  margin-bottom: 24px;
}

.bookshelf-page h1,
.bookshelf-page p,
.continue-card p {
  margin: 0;
}

.bookshelf-page p,
.continue-card p {
  margin-top: 8px;
  color: var(--n-text-color-3);
}

.continue-card {
  margin-bottom: 16px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
  .bookshelf-page__header,
  .continue-card__content {
    align-items: stretch;
    flex-direction: column;
  }

  .bookshelf-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
