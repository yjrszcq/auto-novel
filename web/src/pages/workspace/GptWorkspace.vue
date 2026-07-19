<script lang="ts" setup>
import {
  BookOutlined,
  DeleteOutlineOutlined,
  MoreVertOutlined,
  PlaylistPlayOutlined,
  PlusOutlined,
} from '@vicons/material';
import { VueDraggable } from 'vue-draggable-plus';

import {
  GptWorkerPipeline,
  type GptWorkerPipelineSnapshot,
  Translator,
} from '@/domain/translate';
import { TranslationCacheRepo } from '@/repos';
import type { GptWorker, TranslateJob } from '@/model/Translator';
import { TranslateTaskDescriptor } from '@/model/Translator';
import { doAction } from '@/pages/util';
import SoundAllTaskCompleted from '@/sound/all_task_completed.mp3';
import { useGptWorkspaceStore, useSettingStore } from '@/stores';
import { useRuntimePanel } from '@/util/useRuntimePanel';

const message = useMessage();
const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

const workspace = useGptWorkspaceStore();
const workspaceRef = workspace.ref;

const showCreateWorkerModal = ref(false);
const showLocalVolumeDrawer = ref(false);
const showClearQueueConfirm = ref(false);
const { html: infoPanelHtml } = useRuntimePanel('html/info-gpt.html');
const cacheMetrics =
  ref<Awaited<ReturnType<typeof TranslationCacheRepo.metrics>>>();
const refreshCacheMetrics = async () => {
  cacheMetrics.value = await TranslationCacheRepo.metrics('gpt-seg-cache');
};
onMounted(() => void refreshCacheMetrics());

type ProcessedJob = TranslateJob & {
  progress?: {
    finished: number;
    error: number;
    total: number;
    elapsedMs: number;
  };
};

const emptySnapshot: GptWorkerPipelineSnapshot = {
  outstanding: 0,
  queued: 0,
  waitingProducers: 0,
  aggregateActive: 0,
  aggregateMaximum: 0,
  workers: [],
};
const pipelineSnapshot = shallowRef(emptySnapshot);
const pipeline = new GptWorkerPipeline({
  onSnapshot: (snapshot) => {
    pipelineSnapshot.value = snapshot;
  },
});
pipelineSnapshot.value = pipeline.snapshot();

const translateTask = useTemplateRef('translateTask');
const currentJob = ref<ProcessedJob>();
const queueRunning = ref(false);
const automaticQueue = ref(true);
const startingWorkerIds = ref(new Set<string>());
let taskController: AbortController | undefined;

const workerIsActive = (workerId: string) =>
  pipelineSnapshot.value.workers.some((worker) => worker.id === workerId);
const workerIsStarting = (workerId: string) =>
  startingWorkerIds.value.has(workerId);
const workerActivity = (workerId: string) =>
  pipelineSnapshot.value.workers.find((worker) => worker.id === workerId);
const workerMetrics = computed(() => {
  const running = pipelineSnapshot.value.workers.length;
  const starting = startingWorkerIds.value.size;
  return {
    total: workspaceRef.value.workers.length,
    running,
    starting,
    stopped: Math.max(
      0,
      workspaceRef.value.workers.length - running - starting,
    ),
    active: pipelineSnapshot.value.aggregateActive,
    maximum: pipelineSnapshot.value.aggregateMaximum,
    errors: pipelineSnapshot.value.workers.reduce(
      (total, worker) => total + worker.errors,
      0,
    ),
  };
});
const setWorkerStarting = (workerId: string, starting: boolean) => {
  const next = new Set(startingWorkerIds.value);
  if (starting) next.add(workerId);
  else next.delete(workerId);
  startingWorkerIds.value = next;
};

const workerConfig = (worker: GptWorker) =>
  <const>{
    id: 'gpt',
    model: worker.model,
    endpoint: worker.endpoint,
    key: worker.key,
  };

const runQueuedJobs = async () => {
  if (queueRunning.value || pipelineSnapshot.value.workers.length === 0) return;
  queueRunning.value = true;
  let processedAny = false;
  try {
    while (pipelineSnapshot.value.workers.length > 0) {
      const job = workspaceRef.value.jobs[0] as ProcessedJob | undefined;
      if (job === undefined) break;
      currentJob.value = job;
      processedAny = true;

      let parsed: ReturnType<typeof TranslateTaskDescriptor.parse>;
      try {
        parsed = TranslateTaskDescriptor.parse(job.resumeTask ?? job.task);
      } catch (error) {
        message.error(`任务格式错误，已移到记录：${error}`);
        job.progress = {
          finished: 0,
          error: 1,
          total: 1,
          elapsedMs: 0,
        };
        job.finishAt = Date.now();
        workspace.addJobRecord(job);
        workspace.deleteJob(job.task);
        currentJob.value = undefined;
        continue;
      }

      const { desc, params } = parsed;
      taskController = new AbortController();
      const state = await translateTask.value!.startGptPipelineTask(
        desc,
        params,
        pipeline,
        {
          onProgressUpdated: (progress) => {
            job.resumeTask =
              progress.remainingChapterIds.length === 0
                ? undefined
                : TranslateTaskDescriptor.local(desc.volumeId, {
                    ...params,
                    chapterIds: progress.remainingChapterIds,
                  });
            job.progress = {
              finished: progress.finished,
              error: progress.error,
              total: progress.total,
              elapsedMs: progress.elapsedMs,
            };
            void refreshCacheMetrics();
          },
        },
        taskController.signal,
      );
      taskController = undefined;
      currentJob.value = undefined;

      if (state === 'abort' || state === 'fail') break;
      job.finishAt = Date.now();
      workspace.addJobRecord(job);
      workspace.deleteJob(job.task);
      if (state !== 'complete' || !automaticQueue.value) break;
    }
  } finally {
    taskController = undefined;
    currentJob.value = undefined;
    queueRunning.value = false;
    void refreshCacheMetrics();
  }

  if (
    processedAny &&
    workspaceRef.value.jobs.length === 0 &&
    setting.value.workspaceSound
  ) {
    void new Audio(SoundAllTaskCompleted).play();
  }
};

const startWorker = async (worker: GptWorker) => {
  if (workerIsActive(worker.id) || workerIsStarting(worker.id)) return;
  setWorkerStarting(worker.id, true);
  try {
    const translator = await Translator.create(
      workerConfig(worker),
      true,
      (logMessage, detail) =>
        translateTask.value?.pushLog({
          message: `[${worker.id}] ${logMessage}`,
          detail,
        }),
    );
    if (!workspaceRef.value.workers.some(({ id }) => id === worker.id)) return;
    pipeline.register({
      id: worker.id,
      translator,
      concurrency: worker.concurrency,
    });
    void runQueuedJobs();
  } catch (error) {
    message.error(`无法启动 ${worker.id}：${error}`);
  } finally {
    setWorkerStarting(worker.id, false);
  }
};

const stopWorker = (workerId: string) => {
  pipeline.unregister(workerId);
};

const deleteWorker = (workerId: string) => {
  stopWorker(workerId);
  workspace.deleteWorker(workerId);
};

const startAllWorkers = () =>
  Promise.all(workspaceRef.value.workers.map((worker) => startWorker(worker)));

const stopAllWorkers = () => {
  for (const worker of [...pipelineSnapshot.value.workers]) {
    stopWorker(worker.id);
  }
};

const workerControlOptions = computed(() => [
  {
    label: '启动全部',
    key: 'start',
    disabled: workspaceRef.value.workers.length === 0,
  },
  {
    label: '停止全部',
    key: 'stop',
    disabled: pipelineSnapshot.value.workers.length === 0,
  },
]);

const handleWorkerControl = (key: string | number) => {
  if (key === 'start') void startAllWorkers();
  if (key === 'stop') stopAllWorkers();
};

const activeWorkerConfigs = computed(() => {
  const activeIds = new Set(
    pipelineSnapshot.value.workers.map((worker) => worker.id),
  );
  return workspaceRef.value.workers.filter((worker) =>
    activeIds.has(worker.id),
  );
});

const mixesWorkerConfigurations = computed(
  () =>
    new Set(
      activeWorkerConfigs.value.map(
        (worker) => `${worker.endpoint}\n${worker.model}`,
      ),
    ).size > 1,
);

const stopCurrentTask = () => {
  taskController?.abort();
};

watch(
  () => workspaceRef.value.jobs.length,
  (jobCount, previousJobCount) => {
    if (
      jobCount > previousJobCount &&
      automaticQueue.value &&
      pipelineSnapshot.value.workers.length > 0
    ) {
      void runQueuedJobs();
    }
  },
);

const deleteJob = (task: string) => {
  if (currentJob.value?.task === task) {
    message.error('任务正在由共享池处理');
    return;
  }
  workspace.deleteJob(task);
};
const deleteAllJobs = () => {
  workspaceRef.value.jobs.forEach((job) => {
    if (currentJob.value?.task === job.task) return;
    workspace.deleteJob(job.task);
  });
};

const queueControlOptions = computed(() => [
  queueRunning.value
    ? { label: '停止当前任务', key: 'stop' }
    : {
        label: '继续队列',
        key: 'continue',
        disabled:
          workspaceRef.value.jobs.length === 0 ||
          pipelineSnapshot.value.workers.length === 0,
      },
  {
    label: '清空队列',
    key: 'clear',
    disabled: workspaceRef.value.jobs.length === 0,
  },
]);

const handleQueueControl = (key: string | number) => {
  if (key === 'stop') stopCurrentTask();
  if (key === 'continue') void runQueuedJobs();
  if (key === 'clear') showClearQueueConfirm.value = true;
};

const clearCache = async () => {
  await doAction(
    TranslationCacheRepo.clear('gpt-seg-cache'),
    '缓存清除',
    message,
  );
  await refreshCacheMetrics();
};

onBeforeUnmount(() => {
  taskController?.abort();
  pipeline.close();
});
</script>

<template>
  <div class="layout-content">
    <n-flex
      align="center"
      justify="space-between"
      :wrap="false"
      style="margin-bottom: 0.5em"
    >
      <n-h1 style="margin: 0">GPT工作区</n-h1>
      <workspace-metrics-panel
        :cache-metrics="cacheMetrics"
        :pipeline-metrics="pipelineSnapshot"
        :worker-metrics="workerMetrics"
      />
    </n-flex>

    <bulletin v-if="infoPanelHtml">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-html="infoPanelHtml" />
    </bulletin>

    <section-header title="翻译器">
      <c-button
        label="添加翻译器"
        :icon="PlusOutlined"
        compact-on-mobile
        @action="showCreateWorkerModal = true"
      />
      <c-button-confirm
        hint="真的要清空缓存吗？"
        label="清空缓存"
        :icon="DeleteOutlineOutlined"
        compact-on-mobile
        @action="clearCache"
      />
      <n-dropdown
        trigger="click"
        placement="bottom-end"
        :options="workerControlOptions"
        :keyboard="false"
        @select="handleWorkerControl"
      >
        <n-button circle aria-label="批量控制翻译器">
          <n-icon :component="MoreVertOutlined" />
        </n-button>
      </n-dropdown>
    </section-header>

    <n-alert
      v-if="mixesWorkerConfigurations"
      type="warning"
      title="正在混用不同模型或接口"
      style="margin-top: 12px"
    >
      同一章节的不同分段可能由不同模型完成，文风和术语一致性取决于各模型输出。若一致性优先，请只启动同配置工作者。
    </n-alert>

    <n-empty
      v-if="workspaceRef.workers.length === 0"
      description="没有翻译器"
    />
    <n-list>
      <vue-draggable
        v-model="workspaceRef.workers"
        :animation="150"
        handle=".drag-trigger"
      >
        <n-list-item v-for="worker of workspaceRef.workers" :key="worker.id">
          <gpt-pool-worker
            :worker="worker"
            :active="workerIsActive(worker.id)"
            :starting="workerIsStarting(worker.id)"
            :activity="workerActivity(worker.id)"
            @start="startWorker"
            @stop="stopWorker"
            @delete="deleteWorker"
          />
        </n-list-item>
      </vue-draggable>
    </n-list>

    <n-alert
      v-if="queueRunning && pipelineSnapshot.workers.length === 0"
      type="warning"
      title="任务正在等待工作者"
      style="margin-top: 12px"
    >
      启动任意 GPT 翻译器后会从当前未完成分段继续。
    </n-alert>

    <TranslateTask ref="translateTask" style="margin-top: 20px" />

    <section-header title="任务队列">
      <c-button
        label="本地书架"
        :icon="BookOutlined"
        compact-on-mobile
        @action="showLocalVolumeDrawer = true"
      />
      <n-tooltip placement="top" trigger="hover">
        <template #trigger>
          <c-button
            label="自动队列"
            :icon="PlaylistPlayOutlined"
            :type="automaticQueue ? 'primary' : 'default'"
            :aria-pressed="automaticQueue"
            compact-on-mobile
            @action="automaticQueue = !automaticQueue"
          />
        </template>
        自动处理后续任务：{{ automaticQueue ? '已开启' : '已关闭' }}
      </n-tooltip>
      <n-dropdown
        trigger="click"
        placement="bottom-end"
        :options="queueControlOptions"
        :keyboard="false"
        @select="handleQueueControl"
      >
        <n-button circle aria-label="队列操作">
          <n-icon :component="MoreVertOutlined" />
        </n-button>
      </n-dropdown>
    </section-header>
    <n-empty v-if="workspaceRef.jobs.length === 0" description="没有任务" />
    <n-list>
      <vue-draggable
        v-model="workspaceRef.jobs"
        :animation="150"
        handle=".drag-trigger"
      >
        <n-list-item v-for="job of workspaceRef.jobs" :key="job.task">
          <job-queue
            :job="job"
            :progress="
              currentJob?.task === job.task ? currentJob.progress : undefined
            "
            @top-job="workspace.topJob(job)"
            @bottom-job="workspace.bottomJob(job)"
            @delete-job="deleteJob(job.task)"
          />
        </n-list-item>
      </vue-draggable>
    </n-list>

    <job-record-section id="gpt" />
  </div>

  <local-volume-list-specific-translation
    v-model:show="showLocalVolumeDrawer"
    type="gpt"
  />

  <gpt-worker-modal v-model:show="showCreateWorkerModal" />

  <n-modal
    v-model:show="showClearQueueConfirm"
    preset="dialog"
    title="清空队列"
    positive-text="清空"
    negative-text="取消"
    @positive-click="deleteAllJobs"
  >
    真的要清空队列吗？
  </n-modal>
</template>
