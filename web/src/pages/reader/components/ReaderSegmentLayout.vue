<script lang="ts" setup>
import type { ReaderAnnotation, ReaderSegment } from '@/model/Reader';

import type { RenderedReaderMode } from '../core/BilingualLayout';
import type { ResolvedReaderFlow } from '../core/ReaderFlow';
import { hasTranslation } from '../core/BilingualLayout';
import { indexReaderAnnotations } from '../core/ReaderAnnotations';
import {
  expandSegmentRange,
  getInitialSegmentRange,
} from '../core/ReaderSegmentWindow';
import ReaderSegmentText from './ReaderSegmentText.vue';

const props = defineProps<{
  segments: ReaderSegment[];
  mode: RenderedReaderMode;
  annotations: ReaderAnnotation[];
  initialSegmentId?: string;
  flow: ResolvedReaderFlow;
  scrollRoot?: HTMLElement;
  continuous?: boolean;
}>();

const emit = defineEmits<{
  'content-change': [anchorId?: string];
}>();

const getInitialRange = () =>
  getInitialSegmentRange(
    props.segments.length,
    props.initialSegmentId === undefined
      ? -1
      : props.segments.findIndex(
          (segment) => segment.id === props.initialSegmentId,
        ),
  );

const segmentRange = ref(getInitialRange());
const renderedSegments = computed(() =>
  props.segments.slice(segmentRange.value.start, segmentRange.value.end),
);
const annotationIndex = computed(() =>
  indexReaderAnnotations(props.annotations),
);
const getSegmentAnnotations = (
  segmentId: string,
  languageSide: 'original' | 'translated',
) => annotationIndex.value.get(segmentId, languageSide);
const hasPreviousSegments = computed(() => segmentRange.value.start > 0);
const hasMoreSegments = computed(
  () => segmentRange.value.end < props.segments.length,
);
const layout = ref<HTMLElement>();
const beforeSentinel = ref<HTMLElement>();
const afterSentinel = ref<HTMLElement>();
let loadPreviousObserver: IntersectionObserver | undefined;
let loadMoreObserver: IntersectionObserver | undefined;

const loadPreviousSegments = async () => {
  const anchorId = renderedSegments.value[0]?.id;
  const previousTop =
    props.continuous && anchorId !== undefined
      ? layout.value
          ?.querySelector<HTMLElement>(
            `[data-reader-segment-id="${CSS.escape(anchorId)}"]`,
          )
          ?.getBoundingClientRect().top
      : undefined;
  segmentRange.value = expandSegmentRange(
    segmentRange.value,
    props.segments.length,
    'before',
  );
  await nextTick();
  if (previousTop !== undefined && anchorId !== undefined) {
    const nextTop = layout.value
      ?.querySelector<HTMLElement>(
        `[data-reader-segment-id="${CSS.escape(anchorId)}"]`,
      )
      ?.getBoundingClientRect().top;
    if (nextTop !== undefined) {
      window.scrollBy({ top: nextTop - previousTop, behavior: 'auto' });
    }
    emit('content-change');
    return;
  }
  emit('content-change', anchorId);
};

const observePreviousSegments = () => {
  loadPreviousObserver?.disconnect();
  loadPreviousObserver = undefined;
  if (
    !props.continuous ||
    !hasPreviousSegments.value ||
    beforeSentinel.value === undefined ||
    typeof IntersectionObserver === 'undefined'
  ) {
    return;
  }
  loadPreviousObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadPreviousObserver?.disconnect();
        void loadPreviousSegments();
      }
    },
    { root: null, rootMargin: '640px 0px' },
  );
  loadPreviousObserver.observe(beforeSentinel.value);
};

const loadMoreSegments = async () => {
  const previousRange = segmentRange.value;
  const anchorId = renderedSegments.value.at(-1)?.id;
  segmentRange.value = expandSegmentRange(
    segmentRange.value,
    props.segments.length,
    'after',
  );
  await nextTick();
  emit(
    'content-change',
    segmentRange.value.start > previousRange.start ? anchorId : undefined,
  );
};

const observeMoreSegments = () => {
  loadMoreObserver?.disconnect();
  loadMoreObserver = undefined;
  if (
    !hasMoreSegments.value ||
    afterSentinel.value === undefined ||
    typeof IntersectionObserver === 'undefined'
  ) {
    return;
  }
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreObserver?.disconnect();
        void loadMoreSegments();
      }
    },
    {
      root: props.flow === 'paginated' ? props.scrollRoot : null,
      rootMargin:
        props.flow === 'paginated' ? '0px 640px 0px 0px' : '640px 0px',
    },
  );
  loadMoreObserver.observe(afterSentinel.value);
};

defineExpose({
  hasPreviousSegments: () => hasPreviousSegments.value,
  hasMoreSegments: () => hasMoreSegments.value,
  loadPreviousSegments,
  loadMoreSegments,
});

watch(
  () => [props.segments, props.initialSegmentId],
  () => {
    segmentRange.value = getInitialRange();
    void nextTick().then(() => {
      observePreviousSegments();
      observeMoreSegments();
    });
  },
  { immediate: true },
);
watch(
  () => [
    segmentRange.value.start,
    segmentRange.value.end,
    props.flow,
    props.scrollRoot,
    props.continuous,
  ],
  () =>
    void nextTick().then(() => {
      observePreviousSegments();
      observeMoreSegments();
    }),
);
onBeforeUnmount(() => {
  loadPreviousObserver?.disconnect();
  loadMoreObserver?.disconnect();
});
</script>

<template>
  <section
    ref="layout"
    class="reader-segment-layout"
    :class="`reader-segment-layout--${props.mode}`"
  >
    <div
      v-if="hasPreviousSegments"
      ref="beforeSentinel"
      class="reader-segment-layout__control"
    >
      <n-button size="small" @click="loadPreviousSegments">
        加载前面的段落
      </n-button>
    </div>

    <div
      v-for="segment in renderedSegments"
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
          :annotations="getSegmentAnnotations(segment.id, 'original')"
          :text="segment.original"
        />
      </p>

      <template v-else-if="props.mode === 'translated'">
        <p
          v-if="hasTranslation(segment)"
          class="reader-segment__translated"
          data-reader-language-side="translated"
        >
          <ReaderSegmentText
            :annotations="getSegmentAnnotations(segment.id, 'translated')"
            :text="segment.translated!"
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
            :annotations="getSegmentAnnotations(segment.id, 'translated')"
            :text="hasTranslation(segment) ? segment.translated! : '未翻译'"
          />
        </p>
        <p
          class="reader-segment__original"
          data-reader-language-side="original"
        >
          <ReaderSegmentText
            :annotations="getSegmentAnnotations(segment.id, 'original')"
            :text="segment.original"
          />
        </p>
      </template>

      <template v-else>
        <p
          class="reader-segment__original"
          data-reader-language-side="original"
        >
          <ReaderSegmentText
            :annotations="getSegmentAnnotations(segment.id, 'original')"
            :text="segment.original"
          />
        </p>
        <p
          class="reader-segment__translated"
          data-reader-language-side="translated"
        >
          <ReaderSegmentText
            :annotations="getSegmentAnnotations(segment.id, 'translated')"
            :text="hasTranslation(segment) ? segment.translated! : '未翻译'"
          />
        </p>
      </template>
    </div>

    <div
      v-if="hasMoreSegments"
      ref="afterSentinel"
      class="reader-segment-layout__control"
    >
      <n-button size="small" @click="loadMoreSegments">
        继续加载更多段落
      </n-button>
    </div>
  </section>
</template>

<style scoped>
.reader-segment-layout__control {
  display: flex;
  justify-content: center;
  margin: 16px 0;
}

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
