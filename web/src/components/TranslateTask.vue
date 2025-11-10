<script lang="ts" setup>
import type { SegmentProgressInfo, TranslatorConfig } from '@/domain/translate';
import { translate } from '@/domain/translate';
import type {
  TranslateTaskDesc,
  TranslateTaskParams,
} from '@/model/Translator';
import { releaseKeepAlive, requestKeepAlive } from '@/util';

import CTaskCard from './CTaskCard.vue';

const props = withDefaults(
  defineProps<{
    concurrency?: number;
  }>(),
  {
    concurrency: 1,
  },
);

const emit = defineEmits<{
  'update:jp': [number];
  'update:baidu': [number];
  'update:youdao': [number];
  'update:gpt': [number];
  'update:sakura': [number];
}>();

const message = useMessage();

const title = ref('');
const chapterTotal = ref<number>();
const chapterFinished = ref(0);
const chapterError = ref(0);

type ChapterProgressEntry = {
  key: string;
  chapterIndex?: number;
  chapterTotal?: number;
  totalSegments: number;
  successSegments: number;
  failureSegments: number;
  status: 'running' | 'success' | 'failure';
};

const chapterProgress = ref<ChapterProgressEntry[]>([]);

const refreshChapterProgress = () => {
  chapterProgress.value = [...chapterProgress.value].sort((a, b) => {
    const ai = a.chapterIndex ?? Number.MAX_SAFE_INTEGER;
    const bi = b.chapterIndex ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
};

const ensureChapterEntry = (info: SegmentProgressInfo) => {
  const key =
    info.chapter?.id ??
    (info.chapter?.index !== undefined
      ? `chapter-${info.chapter.index}`
      : `chapter-${chapterProgress.value.length}`);

  let entry = chapterProgress.value.find((it) => it.key === key);
  if (!entry) {
    entry = {
      key,
      chapterIndex: info.chapter?.index,
      chapterTotal: info.chapter?.total,
      totalSegments: info.segmentTotal ?? 0,
      successSegments: 0,
      failureSegments: 0,
      status: 'running',
    };
    chapterProgress.value = [...chapterProgress.value, entry];
  } else {
    entry.chapterIndex ??= info.chapter?.index;
    entry.chapterTotal ??= info.chapter?.total;
    if (info.segmentTotal > 0) {
      entry.totalSegments = info.segmentTotal;
    }
  }
  return entry;
};

const handleSegmentProgress = (info: SegmentProgressInfo) => {
  const entry = ensureChapterEntry(info);
  if (info.status === 'start') {
    entry.totalSegments = info.segmentTotal || entry.totalSegments || 0;
    entry.successSegments = 0;
    entry.failureSegments = 0;
    entry.status = 'running';
  } else if (info.status === 'success') {
    entry.successSegments += 1;
    if (entry.totalSegments < entry.successSegments) {
      entry.totalSegments = entry.successSegments;
    }
  } else if (info.status === 'complete') {
    entry.totalSegments =
      entry.totalSegments ||
      info.segmentTotal ||
      entry.successSegments ||
      entry.failureSegments ||
      1;
    entry.status = 'success';
    entry.failureSegments = Math.max(
      0,
      entry.totalSegments - entry.successSegments,
    );
  } else if (info.status === 'failed') {
    entry.totalSegments =
      entry.totalSegments ||
      info.segmentTotal ||
      entry.successSegments ||
      1;
    entry.status = 'failure';
    const remaining = entry.totalSegments - entry.successSegments;
    entry.failureSegments = remaining > 0 ? remaining : entry.totalSegments;
  }
  refreshChapterProgress();
};

const formatChapterLabel = (chapter: ChapterProgressEntry) => {
  const index =
    chapter.chapterIndex !== undefined ? chapter.chapterIndex : '?';
  const total =
    chapter.chapterTotal !== undefined ? chapter.chapterTotal : '-';
  return `章节${index}/${total}`;
};

const chapterProgressPercentage = (chapter: ChapterProgressEntry) => {
  if (!chapter.totalSegments) return 0;
  return Math.round((chapter.successSegments / chapter.totalSegments) * 100);
};

const chapterProgressStatus = (chapter: ChapterProgressEntry) => {
  if (chapter.status === 'failure') return 'error';
  if (chapter.status === 'success') return 'success';
  return undefined;
};

const overallStatus = computed(() => {
  const total = chapterTotal.value ?? 0;
  if (total === 0) return 'default';
  const processed = chapterFinished.value + chapterError.value;
  if (processed < total) return 'default';
  return chapterError.value > 0 ? 'error' : 'success';
});

const running = ref(false);
const cardRef = ref<InstanceType<typeof CTaskCard>>();

const startTask = async (
  desc: TranslateTaskDesc,
  params: TranslateTaskParams,
  translatorDesc: TranslatorConfig,
  callback?: {
    onProgressUpdated: (progress: {
      finished: number;
      error: number;
      total: number;
    }) => void;
  },
  signal?: AbortSignal,
) => {
  if (running.value) {
    message.info('已有任务在运行。');
    return 'fail';
  }

  const buildLabel = () => {
    const idToLaber = {
      baidu: '百度',
      youdao: '有道',
      gpt: 'GPT',
      sakura: 'Sakura',
    };
    let label = `${idToLaber[translatorDesc.id]}翻译`;
    const suffixParts: string[] = [];
    if (params.level === 'expire') {
      suffixParts.push('过期章节');
    } else if (params.level === 'all') {
      suffixParts.push('全部章节');
    } else if (params.level === 'sync') {
      suffixParts.push('源站同步');
    }
    if (params.forceMetadata) {
      suffixParts.push('重翻目录');
    }
    if (suffixParts.length > 0) {
      label = label + ` [${suffixParts.join('/')}]`;
    }
    return label;
  };

  running.value = true;
  cardRef.value!.clearLog();

  title.value = buildLabel();
  chapterTotal.value = undefined;
  chapterFinished.value = 0;
  chapterError.value = 0;
  chapterProgress.value = [];

  const onProgressUpdated = () =>
    callback?.onProgressUpdated({
      finished: chapterFinished.value,
      error: chapterError.value,
      total: chapterTotal.value ?? 0,
    });

  await requestKeepAlive();
  const concurrency = Math.max(1, props.concurrency ?? 1);

  const state = await translate(
    desc,
    params,
    {
      onStart: (total) => {
        chapterTotal.value = total;
        onProgressUpdated();
      },
      onChapterSuccess: ({ jp, zh }) => {
        if (jp !== undefined) emit('update:jp', jp);
        if (zh !== undefined) {
          if (translatorDesc.id === 'baidu') {
            emit('update:baidu', zh);
          } else if (translatorDesc.id === 'youdao') {
            emit('update:youdao', zh);
          } else if (translatorDesc.id === 'gpt') {
            emit('update:gpt', zh);
          } else {
            emit('update:sakura', zh);
          }
        }
        chapterFinished.value += 1;
        onProgressUpdated();
      },
      onChapterFailure: () => {
        chapterError.value += 1;
        onProgressUpdated();
      },
      log: (message: string, detail?: string[]) => {
        cardRef.value!.pushLog({ message, detail });
      },
    },
    translatorDesc,
    signal,
    {
      concurrency,
      onSegmentProgress: handleSegmentProgress,
    },
  );

  cardRef.value!.pushLog({ message: '\n结束' });
  running.value = false;
  releaseKeepAlive();

  if (state === 'abort') {
    return 'abort';
  }
  const processed = chapterFinished.value + chapterError.value;
  const total = chapterTotal.value ?? processed;
  if (processed >= total) {
    return 'complete';
  }
  return 'uncomplete';
};

defineExpose({ startTask });
</script>

<template>
  <c-task-card
    ref="cardRef"
    :title="title"
    :running="running"
    v-slot="{ logExpand }"
  >
    <div
      class="chapter-progress-panel"
      :style="{ height: logExpand ? '540px' : '180px' }"
    >
      <div class="chapter-progress-summary">
        <n-text>
          成功 {{ chapterFinished }}/{{ chapterTotal ?? '-' }}
          &nbsp;&nbsp;
          失败 {{ chapterError }}/{{ chapterTotal ?? '-' }}
        </n-text>
        <n-progress
          type="line"
          :percentage="
            chapterTotal
              ? Math.round(
                  ((chapterFinished + chapterError) / (chapterTotal || 1)) *
                    100,
                )
              : 0
          "
          :status="overallStatus"
          :show-indicator="false"
        />
      </div>

      <n-divider style="margin: 8px 0" />

      <n-scrollbar class="chapter-progress-scroll">
        <div class="chapter-progress-container">
          <div
            v-for="chapter of chapterProgress"
            :key="chapter.key"
            class="chapter-progress-item"
          >
            <n-text>{{ formatChapterLabel(chapter) }}</n-text>
            <n-progress
              type="line"
              :percentage="chapterProgressPercentage(chapter)"
              :status="chapterProgressStatus(chapter)"
              :show-indicator="false"
            />
            <n-text depth="3" style="display: block">
              成功 {{ chapter.successSegments }}/{{
                chapter.totalSegments || '-'
              }}
              /
              失败 {{ chapter.failureSegments }}/{{
                chapter.totalSegments || '-'
              }}
            </n-text>
          </div>
        </div>
      </n-scrollbar>
    </div>
  </c-task-card>
</template>

<style scoped>
.chapter-progress-panel {
  display: flex;
  flex-direction: column;
  width: 260px;
}
.chapter-progress-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.chapter-progress-scroll {
  flex: 1;
  width: 100%;
}
.chapter-progress-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 8px;
}
.chapter-progress-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
