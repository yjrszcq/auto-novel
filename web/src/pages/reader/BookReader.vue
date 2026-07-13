<script lang="ts" setup>
import type { ReaderPageLoadResult } from './core/ReaderPageState';
import { createReaderPageController } from './core/ReaderPageState';
import { createLocalVolumeReaderAdapter } from './adapters/LocalVolumeReaderAdapter';

import { useLocalVolumeStore } from '@/stores';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const result = shallowRef<ReaderPageLoadResult>();

const bookId = computed(() => route.params.bookId as string);
const requestedChapterId = computed(() =>
  typeof route.params.chapterId === 'string'
    ? route.params.chapterId
    : undefined,
);

const load = async () => {
  loading.value = true;
  const repository = await useLocalVolumeStore();
  const controller = createReaderPageController(
    createLocalVolumeReaderAdapter(repository),
  );
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
};

const navigate = (chapterId: string) => {
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
</script>

<template>
  <main class="book-reader">
    <header class="book-reader__header">
      <n-button text @click="backToBookshelf">返回书架</n-button>
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

      <article class="book-reader__content">
        <p v-for="segment in result.chapter.segments" :key="segment.id">
          {{ segment.original }}
        </p>
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
  </main>
</template>

<style scoped>
.book-reader {
  max-width: 840px;
  margin: 0 auto;
  padding: 24px;
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
  font-size: 18px;
  line-height: 1.9;
}

.book-reader__content p {
  white-space: pre-wrap;
}

.book-reader__navigation {
  margin-top: 36px;
}

@media only screen and (max-width: 600px) {
  .book-reader {
    padding: 16px 12px;
  }

  .book-reader__title {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
