<script lang="ts" setup>
import {
  DeleteOutlineOutlined,
  DragIndicatorOutlined,
  KeyboardDoubleArrowDownOutlined,
  KeyboardDoubleArrowUpOutlined,
  MenuBookOutlined,
} from '@vicons/material';

import {
  TranslateTaskDescriptor,
  type TranslateChapterProgress,
  type TranslateJob,
  type TranslateJobProgress,
} from '@/model/Translator';

const props = defineProps<{
  job: TranslateJob;
  progress?: TranslateJobProgress;
}>();
const emit = defineEmits<{
  topJob: [];
  bottomJob: [];
  deleteJob: [];
}>();
const themeVars = useThemeVars();

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

const processed = computed(
  () => (props.progress?.finished ?? 0) + (props.progress?.error ?? 0),
);
const chapters = computed(() => props.progress?.chapters ?? []);
const chapterLabel = (chapter: TranslateChapterProgress) =>
  chapter.chapterIndex ?? '?';
const chapterSegmentLabel = (chapter: TranslateChapterProgress) =>
  `${chapter.successSegments}/${chapter.totalSegments || '-'}`;
const chapterStyle = (chapter: TranslateChapterProgress) => {
  if (chapter.status === 'failure') {
    return {
      borderColor: themeVars.value.errorColor,
      color: themeVars.value.errorColor,
    };
  }
  if (chapter.status === 'running' || chapter.status === 'success') {
    return {
      borderColor: themeVars.value.primaryColor,
      color: themeVars.value.primaryColor,
      backgroundColor:
        chapter.status === 'success'
          ? `color-mix(in srgb, ${themeVars.value.primaryColor} 14%, transparent)`
          : undefined,
    };
  }
  return {
    borderColor: themeVars.value.borderColor,
    color: themeVars.value.textColor3,
  };
};
</script>

<template>
  <n-thing
    class="job-queue"
    :style="{
      borderColor: progress ? themeVars.primaryColor : themeVars.borderColor,
    }"
  >
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
      {{ job.description }}
    </template>
    <template #header-extra>
      <n-flex :size="6" :wrap="false">
        <n-tag v-if="progress" size="small" type="info">翻译中</n-tag>
        <n-tag v-else size="small">等待中</n-tag>
        <n-text depth="3" class="job-queue__count">
          {{ progress ? `${processed}/${progress.total || '-'}` : '' }}
        </n-text>
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
      <job-task-link :task="job.task" />
      <n-text v-if="percentage" depth="3" class="job-queue__metrics">
        {{ (progress!.elapsedMs / 1000).toFixed(1) }} 秒 /
        {{ throughput.toFixed(1) }} 章/分钟
      </n-text>
    </template>

    <div v-if="chapters.length" class="job-queue__chapters">
      <div
        v-for="chapter of chapters"
        :key="chapter.key"
        class="job-queue__chapter"
        :class="`job-queue__chapter--${chapter.status}`"
        :style="chapterStyle(chapter)"
        :aria-label="`章节 ${chapterLabel(chapter)}，${chapterSegmentLabel(chapter)}`"
      >
        <strong>{{ chapterLabel(chapter) }}</strong>
        <small>{{ chapterSegmentLabel(chapter) }}</small>
        <span
          class="job-queue__chapter-progress"
          :style="{
            backgroundColor: themeVars.primaryColor,
            width: chapter.totalSegments
              ? `${Math.round((chapter.successSegments / chapter.totalSegments) * 100)}%`
              : '0%',
          }"
        />
      </div>
    </div>
  </n-thing>

  <local-volume-glossary-modal
    v-if="volumeId !== undefined"
    v-model:show="showGlossary"
    :volume-id="volumeId"
  />
</template>

<style scoped>
.job-queue {
  padding: 12px;
  border: 1px solid;
}

.job-queue__count {
  min-width: 44px;
  text-align: center;
}

.job-queue__metrics {
  margin-left: 8px;
  font-size: 12px;
}

.job-queue__chapters {
  display: flex;
  gap: 4px;
  margin-top: 10px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.job-queue__chapter {
  position: relative;
  display: grid;
  flex: 0 0 38px;
  height: 42px;
  place-content: center;
  overflow: hidden;
  border: 1px solid;
  text-align: center;
}

.job-queue__chapter strong,
.job-queue__chapter small {
  line-height: 1.1;
}

.job-queue__chapter-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
}

@media (max-width: 639px) {
  .job-queue {
    padding: 10px 8px;
  }

  .job-queue__metrics {
    display: none;
  }
}
</style>
