<script lang="ts" setup>
import {
  ChevronRightOutlined,
  DeleteOutlineOutlined,
  DragIndicatorOutlined,
  KeyboardDoubleArrowDownOutlined,
  KeyboardDoubleArrowUpOutlined,
  MenuBookOutlined,
} from '@vicons/material';

import { collectLocalTranslationChapters } from '@/domain/translate/TranslateLocal';
import {
  TranslateTaskDescriptor,
  type TranslateChapterProgress,
  type TranslateJob,
  type TranslateJobProgress,
  type TranslatorId,
} from '@/model/Translator';
import { useLocalVolumeStore } from '@/stores';

const props = defineProps<{
  job: TranslateJob;
  active: boolean;
  progress?: TranslateJobProgress;
  translatorId: TranslatorId;
}>();
const emit = defineEmits<{
  topJob: [];
  bottomJob: [];
  deleteJob: [];
}>();

const themeVars = useThemeVars();
const expanded = ref(true);
const showGlossary = ref(false);
const plannedChapters = ref<TranslateChapterProgress[]>([]);
let planRevision = 0;

const parsedTask = computed(() => {
  try {
    return TranslateTaskDescriptor.parse(props.job.task);
  } catch {
    return undefined;
  }
});
const volumeId = computed(() => parsedTask.value?.desc.volumeId);

watch(
  () => [props.job.task, props.translatorId] as const,
  async () => {
    const revision = ++planRevision;
    const parsed = parsedTask.value;
    if (parsed === undefined) {
      plannedChapters.value = [];
      return;
    }
    const repository = await useLocalVolumeStore();
    const metadata = await repository.getVolume(parsed.desc.volumeId);
    if (revision !== planRevision) return;
    if (metadata === undefined) {
      plannedChapters.value = [];
      return;
    }
    plannedChapters.value = collectLocalTranslationChapters(
      metadata,
      parsed.params,
      props.translatorId,
    ).map(({ chapterId }, index, chapters) => ({
      key: chapterId,
      chapterIndex: index,
      chapterTotal: chapters.length,
      totalSegments: 0,
      successSegments: 0,
      failureSegments: 0,
      status: 'waiting',
    }));
  },
  { immediate: true },
);

const chapters = computed(() => {
  const progressChapters = props.progress?.chapters ?? [];
  if (plannedChapters.value.length === 0) return progressChapters;
  const progressByKey = new Map(
    progressChapters.map((chapter) => [chapter.key, chapter]),
  );
  const merged = plannedChapters.value.map(
    (chapter) => progressByKey.get(chapter.key) ?? chapter,
  );
  const plannedKeys = new Set(plannedChapters.value.map(({ key }) => key));
  return [
    ...merged,
    ...progressChapters.filter(({ key }) => !plannedKeys.has(key)),
  ];
});
const processed = computed(
  () => (props.progress?.finished ?? 0) + (props.progress?.error ?? 0),
);
const isComplete = computed(
  () => props.progress !== undefined && processed.value >= props.progress.total,
);
const status = computed(() => {
  if (isComplete.value) return 'done';
  if (props.active) return 'executing';
  return 'pending';
});
const total = computed(() => props.progress?.total ?? chapters.value.length);
const throughput = computed(() => {
  if (!props.progress?.elapsedMs) return 0;
  return (processed.value * 60_000) / props.progress.elapsedMs;
});
const hasMetrics = computed(
  () => props.progress !== undefined && props.progress.elapsedMs > 0,
);
</script>

<template>
  <n-card
    size="small"
    hoverable
    class="job-queue"
    :class="{ 'task-card--expanded': expanded }"
    :header-style="{
      cursor: 'pointer',
      padding: '10px 14px',
      userSelect: 'none',
    }"
    :content-style="expanded ? { padding: '0 14px 10px' } : { padding: '0' }"
  >
    <template #header>
      <div @click="expanded = !expanded">
        <n-flex align="center" :wrap="false" style="flex: 1; min-width: 0">
          <n-icon
            class="drag-trigger task-drag"
            :size="18"
            :depth="2"
            :component="DragIndicatorOutlined"
            @click.stop
          />

          <div class="task-identity">
            <div class="task-name">{{ job.description }}</div>
            <div class="task-description">
              <job-task-link :task="job.task" class="task-link" />
              <n-text v-if="hasMetrics" depth="3" class="task-speed">
                {{ (progress!.elapsedMs / 1000).toFixed(1) }} 秒 /
                {{ throughput.toFixed(1) }} 章/分钟
              </n-text>
            </div>
          </div>

          <n-flex :size="8" align="center" :wrap="false" class="task-status">
            <n-tag v-if="status === 'executing'" size="tiny" type="info">
              翻译中
            </n-tag>
            <n-tag v-else-if="status === 'done'" size="tiny" type="success">
              已完成
            </n-tag>
            <n-tag v-else size="tiny">等待中</n-tag>
            <span class="task-progress">{{ processed }}/{{ total }}</span>
          </n-flex>

          <n-flex :size="4" :wrap="false" class="task-actions">
            <c-icon-button
              v-if="!active && volumeId !== undefined"
              tooltip="编辑术语表"
              :icon="MenuBookOutlined"
              @click.stop
              @action="showGlossary = true"
            />
            <c-icon-button
              tooltip="置顶"
              :icon="KeyboardDoubleArrowUpOutlined"
              quaternary
              @click.stop
              @action="emit('topJob')"
            />
            <c-icon-button
              tooltip="置底"
              :icon="KeyboardDoubleArrowDownOutlined"
              quaternary
              @click.stop
              @action="emit('bottomJob')"
            />
            <c-icon-button
              tooltip="删除"
              :icon="DeleteOutlineOutlined"
              type="error"
              quaternary
              @click.stop
              @action="emit('deleteJob')"
            />
          </n-flex>

          <n-icon
            :component="ChevronRightOutlined"
            :class="['expand-arrow', { 'expand-arrow--rotated': expanded }]"
          />
        </n-flex>
      </div>
    </template>

    <job-chapter-grid
      v-if="expanded && chapters.length"
      :active="active"
      :chapters="chapters"
    />
  </n-card>

  <local-volume-glossary-modal
    v-if="volumeId !== undefined"
    v-model:show="showGlossary"
    :volume-id="volumeId"
  />
</template>

<style scoped>
.task-card--expanded {
  --n-border-color: v-bind('themeVars.primaryColorHover');
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
}

.task-drag,
.task-status,
.task-actions,
.expand-arrow {
  flex-shrink: 0;
}

.task-drag {
  cursor: move;
}

.task-identity {
  min-width: 0;
  flex: 1;
}

.task-name {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-description {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.task-link {
  font-size: 11px;
  line-height: 1.2;
}

.task-speed,
.task-progress {
  flex: 0 0 auto;
  color: v-bind('themeVars.textColor3');
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.expand-arrow {
  margin-left: 2px;
  color: v-bind('themeVars.textColor3');
  font-size: 14px;
  transition: transform 0.2s ease;
}

.expand-arrow--rotated {
  transform: rotate(90deg);
}

@media (max-width: 639px) {
  .task-status {
    gap: 4px !important;
  }

  .task-speed {
    display: none;
  }
}
</style>
