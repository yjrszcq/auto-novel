<script lang="ts" setup>
import { useLocalVolumeStore } from '@/stores';

const props = defineProps<{
  bookId: string;
  title: string;
  refreshKey?: number;
}>();

const palette = ['#3f6e8d', '#7d5a8e', '#9b5b48', '#45766e', '#8a713d'];
const coverUrl = ref<string>();
const repositoryPromise = useLocalVolumeStore();

const clearCoverUrl = () => {
  if (coverUrl.value !== undefined) {
    URL.revokeObjectURL(coverUrl.value);
    coverUrl.value = undefined;
  }
};

const loadCover = async () => {
  const bookId = props.bookId;
  const repository = await repositoryPromise;
  const cover = await repository.getReaderCover(bookId);
  if (bookId !== props.bookId) {
    return;
  }
  clearCoverUrl();
  if (cover !== undefined) {
    coverUrl.value = URL.createObjectURL(cover.blob);
  }
};

watch(
  () => [props.bookId, props.refreshKey],
  () => void loadCover(),
  { immediate: true },
);
onBeforeUnmount(clearCoverUrl);

const color = computed(() => {
  const total = Array.from(props.title).reduce(
    (sum, character) => sum + character.codePointAt(0)!,
    0,
  );
  return palette[total % palette.length];
});

const initials = computed(() =>
  Array.from(props.title.trim()).slice(0, 2).join(''),
);
</script>

<template>
  <div class="book-cover" :style="{ backgroundColor: color }">
    <img
      v-if="coverUrl !== undefined"
      class="book-cover__image"
      :src="coverUrl"
      :alt="props.title + ' 封面'"
    />
    <template v-else>
      <span class="book-cover__eyebrow">LOCAL BOOK</span>
      <strong class="book-cover__initials">{{ initials || '书' }}</strong>
      <span class="book-cover__title">{{ props.title }}</span>
    </template>
  </div>
</template>

<style scoped>
.book-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: 14px;
  color: #fff;
}

.book-cover__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.book-cover__eyebrow {
  font-size: 10px;
  letter-spacing: 0.08em;
  opacity: 0.8;
}

.book-cover__initials {
  overflow: hidden;
  font-size: clamp(28px, 6vw, 52px);
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-cover__title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.9;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
