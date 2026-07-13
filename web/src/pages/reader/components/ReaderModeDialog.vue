<script lang="ts" setup>
import type { ReaderMode } from '@/model/Reader';

const props = defineProps<{
  show: boolean;
  modes: ReaderMode[];
  remember: boolean;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  'update:remember': [value: boolean];
  select: [mode: Exclude<ReaderMode, 'ask'>];
}>();

const labels: Record<ReaderMode, string> = {
  ask: '每次询问',
  translated: '译文',
  'translated-original': '译文-原文',
  'original-translated': '原文-译文',
  original: '原文',
};
</script>

<template>
  <n-modal
    :show="props.show"
    :mask-closable="false"
    @update:show="emit('update:show', $event)"
  >
    <n-card title="选择阅读方式" style="width: min(92vw, 420px)">
      <n-space vertical>
        <n-button
          v-for="mode in props.modes.filter((item) => item !== 'ask')"
          :key="mode"
          block
          @click="emit('select', mode)"
        >
          {{ labels[mode] }}
        </n-button>
        <n-checkbox
          :checked="props.remember"
          @update:checked="emit('update:remember', $event)"
        >
          记住本书选择
        </n-checkbox>
      </n-space>
    </n-card>
  </n-modal>
</template>
