<script lang="ts" setup>
import { CloseOutlined } from '@vicons/material';

defineProps<{
  show: boolean;
  title: string;
  wide?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [show: boolean];
}>();
</script>

<template>
  <div
    v-if="show"
    class="reader-sheet"
    @click.self="emit('update:show', false)"
  >
    <section
      class="reader-sheet__panel"
      :class="{ 'reader-sheet__panel--wide': wide }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="reader-sheet__header">
        <h2>{{ title }}</h2>
        <button
          type="button"
          :aria-label="`关闭${title}`"
          @click="emit('update:show', false)"
        >
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
  inset: 0;
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
  padding: 14px 20px max(20px, env(safe-area-inset-bottom));
  overflow: auto;
  overscroll-behavior: contain;
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
    padding: 10px 12px max(14px, env(safe-area-inset-bottom));
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
