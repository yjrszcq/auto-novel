<script lang="ts" setup>
import type { BookshelfDisplayBook } from '../BookshelfPresentation';
import BookCover from './BookCover.vue';

const props = defineProps<{
  book: BookshelfDisplayBook;
}>();

const emit = defineEmits<{
  continue: [book: BookshelfDisplayBook];
  workspace: [book: BookshelfDisplayBook];
  details: [book: BookshelfDisplayBook];
  pin: [book: BookshelfDisplayBook];
  remove: [book: BookshelfDisplayBook];
}>();

const percentage = (value: number) => Math.round(value);

const progressText = (label: string, value: number) =>
  `${label} ${percentage(value)}%`;
</script>

<template>
  <article class="book-card">
    <BookCover
      :book-id="props.book.volume.id"
      :title="props.book.title"
      @select="emit('details', props.book)"
    />
    <div class="book-card__body">
      <div class="book-card__heading">
        <h2 :title="props.book.title">{{ props.book.title }}</h2>
        <n-tag v-if="props.book.state.pinned" size="small" type="warning">
          置顶
        </n-tag>
      </div>

      <div class="book-card__progress" aria-label="阅读与翻译进度">
        <span>{{ progressText('阅读', props.book.readingProgress) }}</span>
        <span>{{ progressText('翻译', props.book.translationProgress) }}</span>
      </div>

      <n-button
        block
        size="small"
        type="primary"
        @click="emit('continue', props.book)"
      >
        {{ props.book.progress === undefined ? '开始阅读' : '继续阅读' }}
      </n-button>
      <div class="book-card__actions">
        <n-button size="tiny" text @click="emit('workspace', props.book)">
          工作区
        </n-button>
        <n-button size="tiny" text @click="emit('details', props.book)">
          详情
        </n-button>
        <n-button size="tiny" text @click="emit('pin', props.book)">
          {{ props.book.state.pinned ? '取消置顶' : '置顶' }}
        </n-button>
        <n-button
          size="tiny"
          text
          type="error"
          @click="emit('remove', props.book)"
        >
          移出书架
        </n-button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.book-card {
  overflow: hidden;
  border: 1px solid var(--n-border-color);
  border-radius: var(--n-border-radius);
  background: var(--n-card-color);
}

.book-card__body {
  display: grid;
  gap: 7px;
  padding: 10px;
}

.book-card__heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.book-card h2 {
  flex: 1;
  overflow: hidden;
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-card__progress {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--n-text-color-3);
  font-size: 12px;
}

.book-card__actions {
  display: flex;
  justify-content: space-between;
  gap: 4px;
}
</style>
