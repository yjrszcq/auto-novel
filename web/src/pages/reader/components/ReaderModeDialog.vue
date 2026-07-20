<script lang="ts" setup>
import { CloseOutlined } from '@vicons/material';
import type { ReaderMode } from '@/model/Reader';
import { getReaderModeLabel } from '../core/ReaderMode';

const props = defineProps<{
  show: boolean;
  modes: ReaderMode[];
  selected: ReaderMode;
  remember: boolean;
  translationPending: boolean;
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
    :mask-closable="true"
    @update:show="emit('update:show', $event)"
  >
    <n-card title="选择阅读语言" style="width: min(92vw, 420px)">
      <template #header-extra>
        <n-button
          quaternary
          circle
          aria-label="关闭阅读语言"
          @click="emit('update:show', false)"
        >
          <template #icon>
            <n-icon :component="CloseOutlined" />
          </template>
        </n-button>
      </template>
      <n-space vertical>
        <n-button
          v-for="mode in props.modes"
          :key="mode"
          block
          :type="mode === props.selected ? 'primary' : 'default'"
          :aria-pressed="mode === props.selected"
          @click="emit('select', mode)"
        >
          {{ getReaderModeLabel(mode, props.sourceLanguage) }}
        </n-button>
        <div class="reader-mode-dialog__preference">
          <n-checkbox
            :checked="props.remember"
            @update:checked="emit('update:remember', $event)"
          >
            记住本书选择
          </n-checkbox>
          <n-text v-if="props.translationPending" type="warning">
            翻译后生效
          </n-text>
        </div>
      </n-space>
    </n-card>
  </n-modal>
</template>

<style scoped>
.reader-mode-dialog__preference {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  gap: 16px;
}
</style>
