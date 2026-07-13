<script lang="ts" setup>
import { TranslateTaskDescriptor } from '@/model/Translator';

const props = defineProps<{
  task: string;
}>();

const link = computed(() => {
  const { params } = TranslateTaskDescriptor.parse(props.task);
  const { level, forceMetadata, startIndex, endIndex } = params;

  let text = 'local';

  if (startIndex > 0 || endIndex < 65535) {
    const endLabel = endIndex < 65535 ? endIndex : 'Inf';
    text += ` [${startIndex},${endLabel})`;
  }

  const tags: string[] = [];
  if (level === 'expire') {
    tags.push('过期章节');
  } else if (level === 'all') {
    tags.push('全部章节');
  } else if (level === 'sync') {
    tags.push('源站同步');
  }
  if (forceMetadata) tags.push('重翻目录');
  if (tags.length > 0) {
    text += ` [${tags.join('/')}]`;
  }

  return text;
});
</script>

<template>
  <n-text depth="3" style="font-size: 12px">
    {{ link }}
  </n-text>
</template>
