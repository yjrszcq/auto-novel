<script lang="ts" setup>
import { CloseOutlined } from '@vicons/material';

const props = defineProps<{
  show: boolean;
  title: string;
  wide?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [show: boolean];
}>();

const panel = ref<HTMLElement>();
let returnFocus: HTMLElement | null = null;

const getFocusableElements = () => [
  ...(panel.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) ?? []),
];

const close = () => emit('update:show', false);

const trapFocus = (event: KeyboardEvent) => {
  const focusable = getFocusableElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    panel.value?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

watch(
  () => props.show,
  async (show) => {
    if (show) {
      returnFocus = document.activeElement as HTMLElement | null;
      await nextTick();
      (getFocusableElements()[0] ?? panel.value)?.focus();
    } else {
      await nextTick();
      returnFocus?.focus();
      returnFocus = null;
    }
  },
);

onBeforeUnmount(() => returnFocus?.focus());
</script>

<template>
  <div v-if="show" class="reader-sheet" @click.self="close">
    <section
      ref="panel"
      class="reader-sheet__panel"
      :class="{ 'reader-sheet__panel--wide': wide }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
      @keydown.esc.stop="close"
      @keydown.tab="trapFocus"
    >
      <header class="reader-sheet__header">
        <h2>{{ title }}</h2>
        <button type="button" :aria-label="`关闭${title}`" @click="close">
          <n-icon :component="CloseOutlined" />
        </button>
      </header>
      <div class="reader-sheet__content">
        <slot />
      </div>
    </section>
  </div>
</template>

<style scoped>
.reader-sheet {
  position: fixed;
  inset: 0 0 var(--reader-bottom-navigation-height, 52px);
  z-index: 2000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  color: var(--reader-text-color, #ddd);
  background: rgb(0 0 0 / 44%);
}

.reader-sheet__panel {
  width: min(100%, 720px);
  max-height: min(72dvh, 680px);
  overflow: hidden;
  background: var(--reader-chrome-background, #242424);
  border: 1px solid var(--reader-chrome-border, rgb(255 255 255 / 10%));
  border-bottom: 0;
  border-radius: 14px 14px 0 0;
  box-shadow: 0 -10px 32px rgb(0 0 0 / 28%);
}

.reader-sheet__panel--wide {
  width: min(100%, 980px);
}

.reader-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 54px;
  padding: 8px 12px 8px 20px;
  border-bottom: 1px solid var(--reader-chrome-border, rgb(255 255 255 / 10%));
}

.reader-sheet__header h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
}

.reader-sheet__header button {
  display: grid;
  width: 40px;
  height: 40px;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 50%;
  place-items: center;
}

.reader-sheet__header button:hover,
.reader-sheet__header button:focus-visible {
  background: rgb(127 127 127 / 18%);
  outline: none;
}

.reader-sheet__header :deep(.n-icon) {
  font-size: 24px;
}

.reader-sheet__content {
  max-height: calc(min(72dvh, 680px) - 55px);
  padding: 14px 20px 20px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--reader-scrollbar-thumb, #626262)
    var(--reader-scrollbar-track, #242424);
}

.reader-sheet__content::-webkit-scrollbar-track,
.reader-sheet__content::-webkit-scrollbar-track-piece {
  background: var(--reader-scrollbar-track, #242424);
}

.reader-sheet__content::-webkit-scrollbar-thumb {
  background: var(--reader-scrollbar-thumb, #626262);
  border: 3px solid var(--reader-scrollbar-track, #242424);
  border-radius: 999px;
}

.reader-sheet__content::-webkit-scrollbar-thumb:hover {
  background: var(--reader-scrollbar-thumb-hover, #7a7a7a);
}

@media only screen and (max-width: 600px) {
  .reader-sheet__panel,
  .reader-sheet__panel--wide {
    max-height: 76dvh;
    border-right: 0;
    border-left: 0;
    border-radius: 12px 12px 0 0;
  }

  .reader-sheet__content {
    max-height: calc(76dvh - 55px);
    padding: 10px 12px 14px;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .reader-sheet__panel {
    animation: reader-sheet-enter 160ms ease-out;
  }

  @keyframes reader-sheet-enter {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
}
</style>
