<script lang="ts" setup>
import {
  createBookshelfService,
  type BookshelfEntry,
} from './BookshelfService';

import { useLocalVolumeStore } from '@/stores';

const books = ref<BookshelfEntry[]>([]);
const loading = ref(true);
const error = ref<string>();

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

onMounted(reload);
</script>

<template>
  <main class="layout-content bookshelf-page">
    <header>
      <h1>书架</h1>
      <p>书籍和阅读数据仅保存在当前浏览器。</p>
    </header>

    <n-skeleton v-if="loading" text :repeat="4" />

    <n-alert v-else-if="error" title="书架加载失败" type="error">
      {{ error }}
    </n-alert>

    <n-empty v-else-if="books.length === 0" description="书架中还没有书籍">
      <template #extra>
        <router-link to="/workspace/toolbox">
          <n-button type="primary">前往工作区导入</n-button>
        </router-link>
      </template>
    </n-empty>

    <n-card v-else :title="`已索引 ${books.length} 本本地书籍`">
      书籍卡片、搜索和排序将在后续书架阶段提供。
    </n-card>
  </main>
</template>

<style scoped>
.bookshelf-page {
  padding-top: 28px;
}

.bookshelf-page header {
  margin-bottom: 24px;
}

.bookshelf-page h1,
.bookshelf-page p {
  margin: 0;
}

.bookshelf-page p {
  margin-top: 8px;
  color: var(--n-text-color-3);
}
</style>
