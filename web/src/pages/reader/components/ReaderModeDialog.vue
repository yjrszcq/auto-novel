<script lang="ts" setup>
import type { ReaderMode } from '@/model/Reader';
import { getReaderModeLabel } from '../core/ReaderMode';

const props = defineProps<{
  show: boolean;
  modes: ReaderMode[];
  remember: boolean;
  sourceLanguage?: string;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  'update:remember': [value: boolean];
  select: [mode: ReaderMode];
}>();
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
          v-for="mode in props.modes"
          :key="mode"
          block
          @click="emit('select', mode)"
        >
          {{ getReaderModeLabel(mode, props.sourceLanguage) }}
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
