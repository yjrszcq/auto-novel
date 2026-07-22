<script lang="ts" setup>
import type { TranslateChapterProgress } from '@/model/Translator';

const props = defineProps<{
  active: boolean;
  chapters: TranslateChapterProgress[];
}>();

const themeVars = useThemeVars();

const displayChapters = computed(() =>
  props.chapters.map((chapter) => ({
    ...chapter,
    displayStatus:
      chapter.status === 'success'
        ? 'done'
        : chapter.status === 'failure'
          ? 'error'
          : chapter.status === 'running' && props.active
            ? 'translating'
            : 'pending',
  })),
);

const percentage = (chapter: TranslateChapterProgress) => {
  if (chapter.totalSegments <= 0) return 0;
  return Math.round((chapter.successSegments / chapter.totalSegments) * 100);
};
</script>

<template>
  <div class="chapter-grid">
    <n-button
      v-for="(chapter, index) of displayChapters"
      :key="chapter.key"
      class="chapter-grid__chapter job-queue__chapter"
      :class="`chapter-grid__chapter--${chapter.displayStatus}`"
      :style="{ '--i': index }"
      :focusable="false"
      quaternary
      :aria-label="`章节 ${chapter.chapterIndex ?? index}`"
    >
      <span class="chapter-grid__order">
        {{ chapter.chapterIndex ?? index }}
      </span>
      <span v-if="chapter.totalSegments > 0" class="chapter-grid__progress">
        {{ chapter.successSegments }}/{{ chapter.totalSegments }}
      </span>

      <n-progress
        v-if="chapter.totalSegments > 0 && chapter.status !== 'success'"
        type="line"
        :percentage="percentage(chapter)"
        :height="3"
        :show-indicator="false"
        :fill-border-radius="0"
        class="chapter-grid__bar"
      />
    </n-button>
  </div>
</template>

<style scoped>
.chapter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
  gap: 2px;
}

.chapter-grid__chapter {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: auto;
  min-height: 0;
  aspect-ratio: 1;
  padding: 2px;
  border: 1px solid v-bind('themeVars.borderColor');
  color: v-bind('themeVars.textColor3');
  animation: chapter-grid-in 0.3s ease both;
  animation-delay: calc(var(--i, 0) * 15ms);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.chapter-grid__chapter :deep(.n-button__content) {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
}

@keyframes chapter-grid-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.chapter-grid__chapter--translating {
  --pulse-from: color-mix(
    in srgb,
    v-bind('themeVars.infoColor') 0%,
    transparent
  );
  --pulse-to: color-mix(
    in srgb,
    v-bind('themeVars.infoColor') 15%,
    transparent
  );
  border-color: color-mix(
    in srgb,
    v-bind('themeVars.infoColor') 35%,
    transparent
  );
  background: color-mix(
    in srgb,
    v-bind('themeVars.infoColor') 10%,
    transparent
  );
  color: v-bind('themeVars.infoColor');
  animation:
    chapter-grid-in 0.3s ease both,
    chapter-grid-pulse 2s infinite;
  animation-delay: calc(var(--i, 0) * 15ms), calc(var(--i, 0) * 15ms + 0.5s);
}

@keyframes chapter-grid-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--pulse-from);
  }
  50% {
    box-shadow: 0 0 0 3px var(--pulse-to);
  }
}

.chapter-grid__chapter--done {
  border-color: color-mix(
    in srgb,
    v-bind('themeVars.successColor') 35%,
    transparent
  );
  background: color-mix(
    in srgb,
    v-bind('themeVars.successColor') 10%,
    transparent
  );
  color: v-bind('themeVars.successColor');
}

.chapter-grid__chapter--error {
  border-color: color-mix(
    in srgb,
    v-bind('themeVars.errorColor') 35%,
    transparent
  );
  background: color-mix(
    in srgb,
    v-bind('themeVars.errorColor') 10%,
    transparent
  );
  color: v-bind('themeVars.errorColor');
}

.chapter-grid__order {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.chapter-grid__progress {
  position: relative;
  z-index: 1;
  font-size: 8px;
  line-height: 1;
  opacity: 0.75;
}

.chapter-grid__bar {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
}
</style>
