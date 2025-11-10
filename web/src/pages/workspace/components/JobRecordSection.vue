<script lang="ts" setup>
import {
  DeleteOutlineOutlined,
  FileDownloadOutlined,
  RefreshOutlined,
} from '@vicons/material';

import {
  TranslateJob,
  TranslateTaskDescriptor,
  type TranslateJobRecord,
} from '@/model/Translator';
import { useBookshelfLocalStore } from '@/pages/bookshelf/BookshelfLocalStore';
import { useWorkspaceStore } from '@/stores';

const props = defineProps<{
  id: 'gpt' | 'sakura';
  enableRetry?: boolean;
  redirectTo?: string;
  title?: string;
}>();

const message = useMessage();
const router = useRouter();
const route = useRoute();

const workspace = useWorkspaceStore(props.id);
const workspaceRef = workspace.ref;

const store = useBookshelfLocalStore();

const progressFilter = ref<'all' | 'finished' | 'unfinished'>('all');
const progressFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'finished', label: '已完成' },
  { value: 'unfinished', label: '未完成' },
];

const records = computed(() => {
  const recordsAll = workspaceRef.value.uncompletedJobs;
  if (progressFilter.value === 'finished') {
    return recordsAll.filter((it) => TranslateJob.isFinished(it));
  } else if (progressFilter.value === 'unfinished') {
    return recordsAll.filter((it) => !TranslateJob.isFinished(it));
  } else {
    return recordsAll;
  }
});

const downloadVolumes = async () => {
  const volumeIds = records.value
    .map((it) => TranslateTaskDescriptor.parse(it.task).desc)
    .filter((it) => it.type === 'local')
    .map((it) => it.volumeId);

  if (volumeIds.length === 0) {
    message.info('列表为空，没有文件需要下载');
    return;
  }

  const { success, failed } = await store.downloadVolumes(volumeIds);
  message.info(`${success}本小说被打包，${failed}本失败`);
};

const retryTooltip = computed(() => '重试未完成任务');
const retryButtonLabel = computed(() => '重试未完成任务');

const targetRoute = computed(
  () => props.redirectTo ?? `/workspace/${props.id}`,
);
const isInTargetRoute = computed(() =>
  route.path.startsWith(targetRoute.value),
);

const navigateAndRun = async (action: () => void) => {
  if (!isInTargetRoute.value) {
    await router.push(targetRoute.value);
  }
  action();
};

const handleRetryAll = () => navigateAndRun(() => workspace.retryAllJobRecords());

const handleRetryJob = (job: TranslateJobRecord) =>
  navigateAndRun(() => workspace.retryJobRecord(job));
</script>

<template>
  <section-header :title="props.title ?? '任务记录'"></section-header>

  <n-flex vertical>
    <c-action-wrapper title="状态">
      <c-radio-group
        v-model:value="progressFilter"
        :options="progressFilterOptions"
        size="small"
      />
    </c-action-wrapper>
    <c-action-wrapper title="操作" align="center">
      <n-button-group size="small">
        <c-button
          :label="retryButtonLabel"
          :icon="RefreshOutlined"
          :round="false"
          @action="handleRetryAll"
        />
        <c-button
          label="下载本地小说"
          :icon="FileDownloadOutlined"
          @click="downloadVolumes"
        />
        <c-button
          label="清空"
          :icon="DeleteOutlineOutlined"
          :round="false"
          @action="workspace.deleteAllJobRecords()"
        />
      </n-button-group>
    </c-action-wrapper>
  </n-flex>

  <n-divider style="margin: 16px 0 0" />

  <n-empty
    v-if="records.length === 0"
    description="没有任务"
    style="padding: 32px"
  />
  <n-list>
    <n-list-item v-for="job of records" :key="job.task">
      <job-record
        :job="job"
        :retry-tooltip="retryTooltip"
        @retry-job="handleRetryJob(job)"
        @delete-job="workspace.deleteJobRecord(job)"
      />
    </n-list-item>
  </n-list>
</template>
