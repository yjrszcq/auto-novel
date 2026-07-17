<script lang="ts" setup>
import { DeleteOutlineOutlined } from '@vicons/material';
import { Epub } from '@/util/file';
import { useLocalVolumeStore, useRuntimeConfigStore } from '@/stores';

const props = defineProps<{
  bookId: string;
  title: string;
  refreshKey?: number;
  selectLabel?: string;
  allowCustomCoverRemoval?: boolean;
  visualOnly?: boolean;
}>();

const emit = defineEmits<{
  select: [];
  remove: [];
}>();

const palette = ['#3f6e8d', '#7d5a8e', '#9b5b48', '#45766e', '#8a713d'];
const coverUrl = ref<string>();
const isCustomCover = ref(false);
const coverElement = ref<HTMLElement>();
const isVisible = ref(false);
let visibilityObserver: IntersectionObserver | undefined;
const repositoryPromise = useLocalVolumeStore();
const runtimeConfigStore = useRuntimeConfigStore();
const vars = useThemeVars();
const { defaultBookCoverImage, loaded, loading } =
  storeToRefs(runtimeConfigStore);

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
      isCustomCover.value = false;
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
      isCustomCover.value = cover.source === 'custom';
    }
  } catch {
    if (bookId === props.bookId) {
      setCoverUrl(undefined);
      isCustomCover.value = false;
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

const select = () => {
  if (!props.visualOnly) {
    emit('select');
  }
};

const remove = () => {
  if (!props.visualOnly && isCustomCover.value) {
    emit('remove');
  }
};

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
const canRemoveCustomCover = computed(
  () =>
    !props.visualOnly && props.allowCustomCoverRemoval && isCustomCover.value,
);
const displayedCoverUrl = computed(
  () => coverUrl.value ?? defaultBookCoverImage.value,
);
const shouldShowTextFallback = computed(
  () =>
    displayedCoverUrl.value.length === 0 && (loaded.value || !loading.value),
);
</script>

<template>
  <div
    ref="coverElement"
    class="book-cover"
    :aria-hidden="props.visualOnly || undefined"
    :style="{
      backgroundColor: color,
      '--book-cover-remove-background': vars.primaryColor,
      '--book-cover-remove-color':
        vars.bodyColor == '#fff' ? '#fff' : '#3a2600',
    }"
  >
    <button
      v-if="!props.visualOnly"
      class="book-cover__select"
      type="button"
      :aria-label="ariaLabel"
      @click="select"
    />
    <button
      v-if="canRemoveCustomCover"
      class="book-cover__remove"
      type="button"
      aria-label="移除自定义封面"
      title="移除自定义封面"
      @click="remove"
    >
      <DeleteOutlineOutlined class="book-cover__remove-icon" />
    </button>
    <img
      v-if="displayedCoverUrl.length > 0"
      class="book-cover__image"
      :src="displayedCoverUrl"
      :alt="`${props.title} 封面`"
      decoding="async"
      loading="lazy"
    />
    <template v-else-if="shouldShowTextFallback">
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

.book-cover__select {
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.book-cover__select:focus-visible,
.book-cover__remove:focus-visible {
  outline: 2px solid var(--n-primary-color);
  outline-offset: -2px;
}

.book-cover__remove {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 0;
  color: var(--book-cover-remove-color);
  background: var(--book-cover-remove-background);
  clip-path: polygon(100% 0, 0 0, 100% 100%);
  cursor: pointer;
  opacity: 0;
  transform: translate(8px, -8px);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.book-cover:hover .book-cover__remove,
.book-cover:focus-within .book-cover__remove {
  opacity: 1;
  transform: none;
}

.book-cover__remove-icon {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 17px;
  height: 17px;
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

@media (hover: none) {
  .book-cover__remove {
    opacity: 1;
    transform: none;
  }
}
</style>
