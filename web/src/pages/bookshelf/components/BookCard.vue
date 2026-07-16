<script lang="ts" setup>
import type { BookshelfDisplayBook } from '../BookshelfPresentation';
import BookCover from './BookCover.vue';

const props = defineProps<{
  book: BookshelfDisplayBook;
}>();

const emit = defineEmits<{
  details: [book: BookshelfDisplayBook];
}>();
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
  line-clamp: 2;
  white-space: normal;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
