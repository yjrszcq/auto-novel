<script lang="ts" setup>
import type { ReaderAnnotation, ReaderSegment } from '@/model/Reader';

import type { RenderedReaderMode } from '../core/BilingualLayout';
import { hasTranslation } from '../core/BilingualLayout';
import ReaderSegmentText from './ReaderSegmentText.vue';

const props = defineProps<{
  segments: ReaderSegment[];
  mode: RenderedReaderMode;
  annotations: ReaderAnnotation[];
}>();
</script>

<template>
  <section
    class="reader-segment-layout"
    :class="`reader-segment-layout--${props.mode}`"
  >
    <div
      v-for="segment in props.segments"
      :key="segment.id"
      class="reader-segment"
      :data-reader-segment-id="segment.id"
    >
      <p
        v-if="props.mode === 'original'"
        class="reader-segment__original"
        data-reader-language-side="original"
      >
        <ReaderSegmentText
          :annotations="props.annotations"
          :segment-id="segment.id"
          :text="segment.original"
          language-side="original"
        />
      </p>

      <template v-else-if="props.mode === 'translated'">
        <p
          v-if="hasTranslation(segment)"
          class="reader-segment__translated"
          data-reader-language-side="translated"
        >
          <ReaderSegmentText
            :annotations="props.annotations"
            :segment-id="segment.id"
            :text="segment.translated!"
            language-side="translated"
          />
        </p>
        <p v-else class="reader-segment__missing">未翻译</p>
      </template>

      <template v-else-if="props.mode === 'translated-original'">
        <p
          class="reader-segment__translated"
          data-reader-language-side="translated"
        >
          <ReaderSegmentText
            :annotations="props.annotations"
            :segment-id="segment.id"
            :text="hasTranslation(segment) ? segment.translated! : '未翻译'"
            language-side="translated"
          />
        </p>
        <p
          class="reader-segment__original"
          data-reader-language-side="original"
        >
          <ReaderSegmentText
            :annotations="props.annotations"
            :segment-id="segment.id"
            :text="segment.original"
            language-side="original"
          />
        </p>
      </template>

      <template v-else>
        <p
          class="reader-segment__original"
          data-reader-language-side="original"
        >
          <ReaderSegmentText
            :annotations="props.annotations"
            :segment-id="segment.id"
            :text="segment.original"
            language-side="original"
          />
        </p>
        <p
          class="reader-segment__translated"
          data-reader-language-side="translated"
        >
          <ReaderSegmentText
            :annotations="props.annotations"
            :segment-id="segment.id"
            :text="hasTranslation(segment) ? segment.translated! : '未翻译'"
            language-side="translated"
          />
        </p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.reader-segment {
  scroll-margin-top: 16px;
  margin: 0 0 1em;
}
.reader-segment p {
  margin: 0;
  white-space: pre-wrap;
}
.reader-segment__translated {
  color: var(--reader-translation-color, inherit);
}
.reader-segment__missing {
  color: var(--n-text-color-3);
  font-style: italic;
}
@media only screen and (min-width: 760px) {
  .reader-segment-layout--translated-original .reader-segment,
  .reader-segment-layout--original-translated .reader-segment {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 36px;
  }
}
</style>
