<script lang="ts" setup>
import { CheckOutlined, PushPinOutlined } from '@vicons/material';

import type { BookshelfDisplayBook } from '../BookshelfPresentation';
import BookCover from './BookCover.vue';

const props = defineProps<{
  book: BookshelfDisplayBook;
  selectable?: boolean;
  selected?: boolean;
}>();

const emit = defineEmits<{
  contextMenu: [book: BookshelfDisplayBook, position: { x: number; y: number }];
  details: [book: BookshelfDisplayBook];
  toggleSelection: [book: BookshelfDisplayBook];
}>();
const vars = useThemeVars();
const longPressDuration = 1000;
const longPressMoveTolerance = 10;
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let longPressStart: { x: number; y: number } | undefined;
let suppressCoverClickUntil = 0;

const selectBook = () => {
  if (props.selectable) emit('toggleSelection', props.book);
  else emit('details', props.book);
};

const isCoverEvent = (event: Event) =>
  event.target instanceof Element &&
  event.target.closest('.book-cover') !== null;

const cancelLongPress = () => {
  if (longPressTimer !== undefined) {
    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
  longPressStart = undefined;
};

const startLongPress = (event: PointerEvent) => {
  if (event.pointerType !== 'touch' || !isCoverEvent(event)) return;
  cancelLongPress();
  longPressStart = { x: event.clientX, y: event.clientY };
  longPressTimer = setTimeout(() => {
    longPressTimer = undefined;
    longPressStart = undefined;
    suppressCoverClickUntil = Date.now() + 500;
    emit('contextMenu', props.book, {
      x: event.clientX,
      y: event.clientY,
    });
  }, longPressDuration);
};

const trackLongPress = (event: PointerEvent) => {
  if (longPressStart === undefined) return;
  if (
    Math.hypot(
      event.clientX - longPressStart.x,
      event.clientY - longPressStart.y,
    ) > longPressMoveTolerance
  ) {
    cancelLongPress();
  }
};

const openMouseContextMenu = (event: MouseEvent) => {
  if (!isCoverEvent(event)) return;
  event.preventDefault();
  if ((event as PointerEvent).pointerType === 'touch') return;
  emit('contextMenu', props.book, { x: event.clientX, y: event.clientY });
};

const suppressLongPressClick = (event: MouseEvent) => {
  if (!isCoverEvent(event) || Date.now() >= suppressCoverClickUntil) return;
  suppressCoverClickUntil = 0;
  event.preventDefault();
  event.stopPropagation();
};

onBeforeUnmount(cancelLongPress);
</script>

<template>
  <article
    class="book-card"
    :class="{
      'book-card--selectable': props.selectable,
    }"
    :style="{ '--book-card-primary-color': vars.primaryColor }"
    @click.capture="suppressLongPressClick"
    @contextmenu="openMouseContextMenu"
    @pointercancel="cancelLongPress"
    @pointerdown="startLongPress"
    @pointerleave="cancelLongPress"
    @pointermove="trackLongPress"
    @pointerup="cancelLongPress"
  >
    <BookCover
      :book-id="props.book.volume.id"
      :title="props.book.title"
      @select="selectBook"
    />
    <div
      v-if="props.book.state.pinned"
      class="book-card__pinned"
      aria-label="已置顶"
    >
      <n-icon :component="PushPinOutlined" />
    </div>
    <button
      v-if="props.selectable"
      class="book-card__selection"
      :class="{ 'book-card__selection--checked': props.selected }"
      type="button"
      :aria-label="props.selected ? '取消选择' : '选择书籍'"
      :aria-pressed="props.selected"
      @click="selectBook"
    >
      <n-icon v-if="props.selected" :component="CheckOutlined" />
    </button>
    <div class="book-card__body">
      <div class="book-card__heading">
        <h2 :title="props.book.title">{{ props.book.title }}</h2>
      </div>
    </div>
  </article>
</template>

<style scoped>
.book-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--n-border-color);
  border-radius: var(--n-border-radius);
  background: var(--n-card-color);
}

.book-card--selectable {
  cursor: pointer;
}

.book-card :deep(.book-cover) {
  -webkit-touch-callout: none;
  user-select: none;
}

.book-card__pinned {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  width: 54px;
  height: 54px;
  color: #fff;
  background: var(--book-card-primary-color);
  clip-path: polygon(0 0, 100% 0, 100% 100%);
  pointer-events: none;
}

.book-card__pinned :deep(.n-icon) {
  position: absolute;
  top: 7px;
  right: 7px;
  font-size: 23px;
}

.book-card__selection {
  position: absolute;
  z-index: 3;
  top: 8px;
  left: 8px;
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 2px solid rgb(255 255 255 / 90%);
  border-radius: 50%;
  color: #fff;
  background: rgb(0 0 0 / 45%);
  box-shadow: 0 1px 5px rgb(0 0 0 / 35%);
  cursor: pointer;
  place-items: center;
}

.book-card__selection--checked {
  background: var(--book-card-primary-color);
}

.book-card__selection :deep(.n-icon) {
  font-size: 18px;
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

@media only screen and (max-width: 600px) {
  .book-card__pinned {
    width: 42px;
    height: 42px;
  }

  .book-card__pinned :deep(.n-icon) {
    top: 5px;
    right: 5px;
    font-size: 18px;
  }

  .book-card__selection {
    top: 5px;
    left: 5px;
    width: 24px;
    height: 24px;
  }
}
</style>
