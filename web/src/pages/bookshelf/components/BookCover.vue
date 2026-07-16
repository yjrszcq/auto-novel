<script lang="ts" setup>
import { Epub } from '@/util/file';
import { useLocalVolumeStore } from '@/stores';

const props = defineProps<{
  bookId: string;
  title: string;
  refreshKey?: number;
  selectLabel?: string;
}>();

const emit = defineEmits<{
  select: [];
}>();

const palette = ['#3f6e8d', '#7d5a8e', '#9b5b48', '#45766e', '#8a713d'];
const coverUrl = ref<string>();
const coverElement = ref<HTMLElement>();
const isVisible = ref(false);
let visibilityObserver: IntersectionObserver | undefined;
const repositoryPromise = useLocalVolumeStore();

const clearCoverUrl = () => {
  if (coverUrl.value !== undefined) {
    URL.revokeObjectURL(coverUrl.value);
    coverUrl.value = undefined;
  }
};

const setCoverUrl = (blob: Blob | undefined) => {
  clearCoverUrl();
  if (blob !== undefined) {
    coverUrl.value = URL.createObjectURL(blob);
  }
};

const observeCover = () => {
  if (
    coverElement.value === undefined ||
    typeof IntersectionObserver === 'undefined'
  ) {
    isVisible.value = true;
    return;
  }
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        isVisible.value = true;
        visibilityObserver?.disconnect();
      }
    },
    { rootMargin: '400px' },
  );
  visibilityObserver.observe(coverElement.value);
};

const loadCover = async () => {
  const bookId = props.bookId;
  try {
    const repository = await repositoryPromise;
    let cover = await repository.getReaderCover(bookId);
    if (bookId !== props.bookId) {
      return;
    }
    if (cover === undefined) {
      setCoverUrl(undefined);
      if (!bookId.toLowerCase().endsWith('.epub')) {
        return;
      }
      const sourceFile = await repository.getFile(bookId);
      const blob =
        sourceFile === undefined
          ? undefined
          : await Epub.extractCoverFromFile(sourceFile.file);
      if (bookId !== props.bookId || blob === undefined) {
        return;
      }
      const latestCover = await repository.getReaderCover(bookId);
      if (latestCover !== undefined) {
        cover = latestCover;
      } else {
        cover = {
          bookId,
          blob,
          source: 'embedded',
          updatedAt: Date.now(),
        };
        await repository.putReaderCover(cover);
      }
    }
    if (bookId === props.bookId) {
      setCoverUrl(cover.blob);
    }
  } catch {
    if (bookId === props.bookId) {
      setCoverUrl(undefined);
    }
  }
};

watch(
  () => [props.bookId, props.refreshKey, isVisible.value],
  () => {
    if (isVisible.value) {
      void loadCover();
    }
  },
  { immediate: true },
);
onMounted(observeCover);
onBeforeUnmount(() => {
  visibilityObserver?.disconnect();
  clearCoverUrl();
});

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
const ariaLabel = computed(
  () => props.selectLabel ?? '查看《' + props.title + '》详情',
);
</script>

<template>
  <div
    ref="coverElement"
    class="book-cover"
    role="button"
    tabindex="0"
    :aria-label="ariaLabel"
    :style="{ backgroundColor: color }"
    @click="emit('select')"
    @keydown.enter.prevent="emit('select')"
    @keydown.space.prevent="emit('select')"
  >
    <img
      v-if="coverUrl !== undefined"
      class="book-cover__image"
      :src="coverUrl"
      :alt="props.title + ' 封面'"
      decoding="async"
      loading="lazy"
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
  cursor: pointer;
}

.book-cover:focus-visible {
  outline: 2px solid var(--n-primary-color);
  outline-offset: -2px;
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
