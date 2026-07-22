<script lang="ts" setup>
import {
  DeleteOutlineOutlined,
  DragIndicatorOutlined,
  KeyboardDoubleArrowDownOutlined,
  KeyboardDoubleArrowUpOutlined,
  MenuBookOutlined,
} from '@vicons/material';

import { TranslateTaskDescriptor, type TranslateJob } from '@/model/Translator';

const props = defineProps<{
  job: TranslateJob;
  progress?: {
    finished: number;
    error: number;
    total: number;
    elapsedMs: number;
  };
}>();
const emit = defineEmits<{
  topJob: [];
  bottomJob: [];
  deleteJob: [];
}>();

const showGlossary = ref(false);
const volumeId = computed(() => {
  try {
    return TranslateTaskDescriptor.parse(props.job.task).desc.volumeId;
  } catch {
    return undefined;
  }
});

const percentage = computed(() => {
  if (props.progress === undefined) {
    return 0;
  }
  const { finished, error, total } = props.progress;
  if (total === 0) {
    return 100;
  } else {
    return Math.round((1000 * (finished + error)) / total) / 10;
  }
});
const throughput = computed(() => {
  if (!props.progress?.elapsedMs) return 0;
  const processed = props.progress.finished + props.progress.error;
  return (processed * 60_000) / props.progress.elapsedMs;
});
</script>

<template>
  <n-thing>
    <template #avatar>
      <n-flex vertical justify="center" style="height: 100%">
        <n-icon
          class="drag-trigger"
          :size="18"
          :depth="2"
          :component="DragIndicatorOutlined"
          style="cursor: move"
        />
      </n-flex>
    </template>

    <template #header>
      <job-task-link :task="job.task" />
    </template>
    <template #header-extra>
      <n-flex :size="6" :wrap="false">
        <c-icon-button
          v-if="progress === undefined && volumeId !== undefined"
          tooltip="编辑术语表"
          :icon="MenuBookOutlined"
          @action="showGlossary = true"
        />

        <c-icon-button
          tooltip="置顶"
          :icon="KeyboardDoubleArrowUpOutlined"
          @action="emit('topJob')"
        />

        <c-icon-button
          tooltip="置底"
          :icon="KeyboardDoubleArrowDownOutlined"
          @action="emit('bottomJob')"
        />

        <c-icon-button
          tooltip="删除"
          :icon="DeleteOutlineOutlined"
          type="error"
          @action="emit('deleteJob')"
        />
      </n-flex>
    </template>

    <template #description>
      {{ job.description }}
      <template v-if="percentage">
        <n-progress :percentage="percentage" style="max-width: 600px" />
        <n-text depth="3">
          {{ (progress!.elapsedMs / 1000).toFixed(1) }} 秒 /
          {{ throughput.toFixed(1) }} 章/分钟
        </n-text>
      </template>
    </template>
  </n-thing>

  <local-volume-glossary-modal
    v-if="volumeId !== undefined"
    v-model:show="showGlossary"
    :volume-id="volumeId"
  />
</template>
