<script lang="ts" setup>
import type { ReaderAnnotation } from '@/model/Reader';

import { getAnnotationFragments } from '../core/ReaderAnnotations';

const props = defineProps<{
  text: string;
  annotations: ReaderAnnotation[];
}>();

const fragments = computed(() =>
  getAnnotationFragments(props.text, props.annotations),
);
</script>

<template>
  <span
    v-for="(fragment, index) in fragments"
    :key="index"
    :class="fragment.style && 'reader-annotation--' + fragment.style"
  >
    {{ fragment.text }}
  </span>
</template>

<style scoped>
.reader-annotation--highlight {
  background: #f4df78;
  color: inherit;
}
.reader-annotation--underline {
  text-decoration: underline 2px #d68d1a;
}
.reader-annotation--strike {
  text-decoration: line-through;
}
.reader-annotation--wavy {
  text-decoration: underline wavy #d66;
}
</style>
