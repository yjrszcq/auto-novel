<script lang="ts" setup>
import { DeleteOutlineOutlined, RefreshOutlined } from '@vicons/material';

import type { TranslateJobRecord } from '@/model/Translator';
import { TranslateJob, TranslateTaskDescriptor } from '@/model/Translator';

const props = defineProps<{
  job: TranslateJobRecord;
  retryTooltip?: string;
}>();
const emit = defineEmits<{
  retryJob: [];
  deleteJob: [];
}>();
const isFinished = computed(() => TranslateJob.isFinished(props.job));
const remainingCount = computed(() => {
  if (props.job.resumeTask === undefined) return 0;
  return (
    TranslateTaskDescriptor.parse(props.job.resumeTask).params.chapterIds
      ?.length ?? 0
  );
});
</script>

<template>
  <n-thing>
    <template #header>
      <job-task-link :task="job.task" />
    </template>
    <template #header-extra>
      <n-flex :size="6" :wrap="false">
        <c-icon-button
          v-if="!isFinished"
          :tooltip="props.retryTooltip ?? '重试'"
          :icon="RefreshOutlined"
          @action="emit('retryJob')"
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
      <br />
      <n-text depth="3">
        <template v-if="!isFinished">
          未完成
          <template v-if="job.progress !== undefined">
            总共 {{ job.progress?.total }} / 成功 {{ job.progress?.finished }} /
            失败 {{ job.progress?.error }} / 待重试 {{ remainingCount }} / 用时
            {{ (job.progress.elapsedMs / 1000).toFixed(1) }} 秒
          </template>
        </template>
        <template v-else>
          已完成
          <n-time v-if="job?.finishAt" :time="job?.finishAt" type="datetime" />
        </template>
      </n-text>
    </template>
  </n-thing>
</template>
