<script lang="ts" setup>
import {
  DeleteOutlineOutlined,
  MoreVertOutlined,
  WorkspacesOutlined,
} from '@vicons/material';

import bannerUrl from '@/image/banner.webp';
import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import {
  LocalVolumeManagerUtil,
  useLocalVolumeManager,
} from '@/pages/workspace/LocalVolumeManager';
import {
  Setting,
  useLocalVolumeStore,
  useSettingStore,
} from '@/stores';
import { useBreakPoints } from '@/pages/util';
import { downloadFile } from '@/util';
import { useRuntimePanel } from '@/util/useRuntimePanel';

const bp = useBreakPoints();
const showShortcut = bp.smaller('tablet');

const vars = useThemeVars();

const keyword = ref('');
const { html: infoPanelHtml } = useRuntimePanel('info.html');

const quickActions = [
  { label: '小说工具箱', to: '/workspace/toolbox', icon: WorkspacesOutlined },
  { label: 'GPT工作区', to: '/workspace/gpt', icon: WorkspacesOutlined },
  { label: 'Sakura工作区', to: '/workspace/sakura', icon: WorkspacesOutlined },
  { label: '交互翻译', to: '/workspace/interactive', icon: WorkspacesOutlined },
];

const localRepo = shallowRef<Awaited<ReturnType<typeof useLocalVolumeStore>>>();
const ensureLocalRepo = async () => {
  if (!localRepo.value) {
    localRepo.value = await useLocalVolumeStore();
  }
  return localRepo.value;
};

const message = useMessage();

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

const localVolumeManager = useLocalVolumeManager();
const { volumes } = storeToRefs(localVolumeManager);

const localShelfSearch = reactive({ query: '', enableRegexMode: false });
const localShelfLoading = ref(false);
const showDeleteModal = ref(false);

const progressFilter = ref<'all' | 'finished' | 'unfinished'>('all');
const progressFilterOptions = [
  { label: '全部', value: 'all' },
  { label: '已完成', value: 'finished' },
  { label: '未完成', value: 'unfinished' },
];

const batchMenuOptions = [
  { label: '批量下载', key: 'batch-download' },
  { label: '批量删除', key: 'batch-delete' },
];

type TranslatorType = 'gpt' | 'sakura';

const isTranslatorFinished = (
  volume: LocalVolumeMetadata,
  type: TranslatorType,
) =>
  volume.toc.length > 0 &&
  volume.toc.every((chapter) => {
    const chapterGlossaryId = type === 'gpt' ? chapter.gpt : chapter.sakura;
    return chapterGlossaryId === volume.glossaryId;
  });

const translatorPriority = computed<TranslatorType[]>(() =>
  setting.value.homeDownloadPriority === 'gpt'
    ? ['gpt', 'sakura']
    : ['sakura', 'gpt'],
);

const pickPreferredTranslator = (volume: LocalVolumeMetadata) => {
  for (const translator of translatorPriority.value) {
    if (isTranslatorFinished(volume, translator)) {
      return translator;
    }
  }
  return null;
};

const sortedLocalVolumes = computed(() =>
  LocalVolumeManagerUtil.filterAndSortVolumes(volumes.value ?? [], {
    query: localShelfSearch.query,
    enableRegexMode: localShelfSearch.enableRegexMode,
    order: setting.value.localVolumeOrder,
  }),
);

const filteredLocalVolumes = computed(() =>
  sortedLocalVolumes.value.filter((volume) => {
    switch (progressFilter.value) {
      case 'finished':
        return pickPreferredTranslator(volume) !== null;
      case 'unfinished':
        return pickPreferredTranslator(volume) === null;
      default:
        return true;
    }
  }),
);

watch(
  () => keyword.value,
  (value) => {
    localShelfSearch.query = value;
  },
);

const handleSearch = () => {
  const trimmed = keyword.value.trim();
  keyword.value = trimmed;
  localShelfSearch.query = trimmed;
};

const loadLocalShelf = async () => {
  localShelfLoading.value = true;
  try {
    await localVolumeManager.loadVolumes();
  } catch (error) {
    message.error(`本地书架加载失败：${error}`);
  } finally {
    localShelfLoading.value = false;
  }
};

onMounted(() => {
  loadLocalShelf();
});

const getTranslationStats = (
  volume: LocalVolumeMetadata,
  type: 'gpt' | 'sakura',
) => {
  const finished = volume.toc.filter((chapter) => {
    const chapterGlossaryId = type === 'gpt' ? chapter.gpt : chapter.sakura;
    return chapterGlossaryId === volume.glossaryId;
  }).length;
  const expired = volume.toc.filter((chapter) => {
    const chapterGlossaryId = type === 'gpt' ? chapter.gpt : chapter.sakura;
    return (
      chapterGlossaryId !== undefined &&
      chapterGlossaryId !== volume.glossaryId
    );
  }).length;
  return { finished, expired, total: volume.toc.length };
};

const formatTranslationSummary = (
  volume: LocalVolumeMetadata,
  type: 'gpt' | 'sakura',
) => {
  const { finished, expired, total } = getTranslationStats(volume, type);
  if (total === 0) {
    return '暂无章节';
  }
  return `完成 ${finished}/${total}${expired ? ` · 过期 ${expired}` : ''}`;
};

const queueVolumeToWorkspace = (
  volume: LocalVolumeMetadata,
  type: 'gpt' | 'sakura',
) => {
  const results = localVolumeManager.queueJobToWorkspace(volume.id, {
    level: 'all',
    type,
    shouldTop: false,
    startIndex: 0,
    endIndex: 65535,
    taskNumber: 1,
    total: volume.toc.length ?? 65535,
  });
  const success = results.every((item) => item);
  message[success ? 'success' : 'error'](
    success
      ? `${volume.id} 已加入${type === 'gpt' ? ' GPT' : ' Sakura'}工作区`
      : `${volume.id} 已在对应工作区的队列中`,
  );
};

const handleRefreshShelf = (event?: MouseEvent) => {
  loadLocalShelf();
  const target = event?.currentTarget as HTMLElement | undefined;
  target?.blur?.();
};

const handleBatchDownload = async () => {
  if (filteredLocalVolumes.value.length === 0) {
    message.info('没有选中小说');
    return;
  }
  const { BlobReader, BlobWriter, ZipWriter } = await import('@zip.js/zip.js');
  const zipBlobWriter = new BlobWriter();
  const zipWriter = new ZipWriter(zipBlobWriter);

  let success = 0;
  let failed = 0;

  for (const volume of filteredLocalVolumes.value) {
    try {
      const { filename, blob } = await buildDownloadPayload(volume);
      await zipWriter.add(filename, new BlobReader(blob));
      success += 1;
    } catch (error) {
      failed += 1;
      console.error(`批量下载失败：${error}\n标题:${volume.id}`);
    }
  }

  await zipWriter.close();

  if (success > 0) {
    const zipBlob = await zipBlobWriter.getData();
    downloadFile(`批量下载[${success}].zip`, zipBlob);
  }
  message.info(`${success}本小说被打包，${failed}本失败`);
};

const deleteAllFilteredVolumes = async () => {
  if (filteredLocalVolumes.value.length === 0) {
    message.info('没有选中小说');
    return;
  }
  const ids = filteredLocalVolumes.value.map((it) => it.id);
  const { success, failed } = await localVolumeManager.deleteVolumes(ids);
  showDeleteModal.value = false;
  message.info(`${success}本小说被删除，${failed}本失败`);
};

const handleBatchMenuSelect = (key: string) => {
  if (filteredLocalVolumes.value.length === 0) {
    message.info('没有选中小说');
    return;
  }
  switch (key) {
    case 'batch-download':
      handleBatchDownload();
      break;
    case 'batch-delete':
      showDeleteModal.value = true;
      break;
    default:
      break;
  }
};

const getTranslatedFile = async (
  volumeId: string,
  translator: TranslatorType,
) => {
  const repo = await ensureLocalRepo();
  const { translationsMode } = setting.value.downloadFormat;
  return repo.getTranslationFile({
    id: volumeId,
    mode: setting.value.homeDownloadMode,
    translationsMode,
    translations: [translator],
  });
};

const getRawFile = async (volumeId: string) => {
  const repo = await ensureLocalRepo();
  const file = await repo.getFile(volumeId);
  if (!file) return undefined;
  return { filename: volumeId, blob: file.file };
};

const downloadTranslatedVolume = async (
  volumeId: string,
  translator: TranslatorType,
) => {
  try {
    const { filename, blob } = await getTranslatedFile(volumeId, translator);
    downloadFile(filename, blob);
    message.success('已开始下载译文');
  } catch (error) {
    message.error(`下载失败：${error}`);
  }
};

const downloadRawVolume = async (volumeId: string) => {
  try {
    const file = await getRawFile(volumeId);
    if (!file) {
      message.error('原始文件不存在');
      return;
    }
    downloadFile(file.filename, file.blob);
    message.success('已开始下载原文');
  } catch (error) {
    message.error(`下载失败：${error}`);
  }
};

const findVolumeById = (volumeId: string) =>
  volumes.value?.find((volume) => volume.id === volumeId);

const buildDownloadPayload = async (volume: LocalVolumeMetadata) => {
  const preferredTranslator = pickPreferredTranslator(volume);
  if (preferredTranslator) {
    return getTranslatedFile(volume.id, preferredTranslator);
  }
  const raw = await getRawFile(volume.id);
  if (!raw) {
    throw new Error('原始文件不存在');
  }
  return raw;
};

const handleDownloadVolume = async (volumeId: string) => {
  const targetVolume = findVolumeById(volumeId);
  if (!targetVolume) {
    message.error('未找到小说');
    return;
  }
  const translator = pickPreferredTranslator(targetVolume);
  if (translator) {
    await downloadTranslatedVolume(volumeId, translator);
    return;
  }
  await downloadRawVolume(volumeId);
};

const deleteLocalVolume = async (volumeId: string) => {
  try {
    await localVolumeManager.deleteVolume(volumeId);
    message.success(`已删除《${volumeId}》`);
  } catch (error) {
    message.error(`删除失败：${error}`);
  }
};

</script>

<template>
  <div
    :style="{ background: `rgba(0, 0, 0, .25) url(${bannerUrl})` }"
    style="background-blend-mode: darken"
  >
    <div id="banner" class="layout-content">
      <n-h1
        style="
          text-align: center;
          font-size: 3em;
          color: white;
          filter: drop-shadow(0.05em 0.05em black);
        "
      >
        轻小说机翻机器人
      </n-h1>
      <n-input-group>
        <n-input
          v-model:value="keyword"
          size="large"
          placeholder="输入小说文件名，搜索本地书架"
          :input-props="{ spellcheck: false }"
          @keyup.enter="handleSearch"
          :style="{ 'background-color': vars.bodyColor }"
        />
        <n-button size="large" type="primary" @click="handleSearch">
          搜索
        </n-button>
      </n-input-group>
    </div>
  </div>

  <div class="layout-content">
    <n-flex
      v-if="showShortcut"
      :size="0"
      justify="space-around"
      :wrap="false"
      style="margin: 8px 0px"
    >
      <router-link
        v-for="action in quickActions"
        :key="action.to"
        :to="action.to"
        style="flex: 1"
      >
        <n-button quaternary style="width: 100%; height: 64px">
          <n-flex align="center" vertical style="font-size: 12px">
            <n-icon size="24" :component="action.icon" />
            {{ action.label }}
          </n-flex>
        </n-button>
      </router-link>
    </n-flex>
    <div v-else style="height: 16px" />

    <bulletin v-if="infoPanelHtml">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-html="infoPanelHtml" />
    </bulletin>

    <section-header title="本地书架">
      <local-volume-upload-button />
      <c-button label="刷新" @action="handleRefreshShelf" />
      <n-dropdown
        trigger="click"
        :options="batchMenuOptions"
        :keyboard="false"
        @select="handleBatchMenuSelect"
      >
        <n-button circle>
          <n-icon :component="MoreVertOutlined" />
        </n-button>
      </n-dropdown>
    </section-header>

    <n-card class="local-shelf-card" size="small">
      <n-flex vertical :size="12">
        <c-action-wrapper title="排序" align="center">
          <order-sort
            v-model:value="setting.localVolumeOrder"
            :options="Setting.localVolumeOrderOptions"
          />
        </c-action-wrapper>

        <c-action-wrapper title="状态">
          <c-radio-group
            v-model:value="progressFilter"
            :options="progressFilterOptions"
            size="small"
          />
        </c-action-wrapper>
      </n-flex>

      <n-divider style="margin: 16px 0 8px" />

      <n-skeleton v-if="localShelfLoading" text :repeat="3" />
      <n-empty
        v-else-if="filteredLocalVolumes.length === 0"
        :description="keyword.length === 0 ? '还没有本地小说' : '没有匹配的小说'"
      />
      <n-list v-else class="local-shelf-list">
        <n-list-item
          v-for="volume in filteredLocalVolumes"
          :key="volume.id"
        >
          <n-thing :title="volume.id">
            <template #description>
              <n-text depth="3">
                创建于
                <n-time :time="volume.createAt" type="relative" />
                ，共 {{ volume.toc.length }} 个分段
              </n-text>
            </template>
            <template #footer>
              <n-space :size="8" wrap>
                <n-tag size="small" type="info">
                  GPT · {{ formatTranslationSummary(volume, 'gpt') }}
                </n-tag>
                <n-tag size="small" type="success">
                  Sakura · {{ formatTranslationSummary(volume, 'sakura') }}
                </n-tag>
              </n-space>

              <n-flex :size="8" wrap style="margin-top: 8px">
                <c-button
                  label="排队 GPT"
                  size="tiny"
                  secondary
                  @action="queueVolumeToWorkspace(volume, 'gpt')"
                />
                <c-button
                  label="排队 Sakura"
                  size="tiny"
                  secondary
                  @action="queueVolumeToWorkspace(volume, 'sakura')"
                />
                <router-link
                  v-if="!volume.id.endsWith('.epub')"
                  :to="`/workspace/reader/${encodeURIComponent(volume.id)}/0`"
                  target="_blank"
                >
                  <c-button label="阅读" size="tiny" secondary />
                </router-link>
                <c-button
                  label="下载"
                  size="tiny"
                  secondary
                  @action="handleDownloadVolume(volume.id)"
                />
                <c-button
                  label="原文"
                  size="tiny"
                  secondary
                  @action="downloadRawVolume(volume.id)"
                />
                <div style="flex: 1" />
                <c-button-confirm
                  :hint="`真的要删除《${volume.id}》吗？`"
                  :icon="DeleteOutlineOutlined"
                  size="tiny"
                  secondary
                  circle
                  type="error"
                  @action="deleteLocalVolume(volume.id)"
                />
              </n-flex>
            </template>
          </n-thing>
        </n-list-item>
      </n-list>
    </n-card>

    <c-modal title="清空所有文件" v-model:show="showDeleteModal">
      <n-p>
        这将删除当前筛选结果中的所有EPUB/TXT文件，无法恢复。你确定吗？
      </n-p>

      <template #action>
        <c-button
          label="确定"
          type="primary"
          @action="deleteAllFilteredVolumes"
        />
      </template>
    </c-modal>
  </div>
</template>

<style scoped>
#banner {
  max-width: 800px;
  padding-top: 20px;
  padding-bottom: 50px;
}
@media only screen and (max-width: 600px) {
  #banner {
    padding-top: 10px;
    padding-bottom: 35px;
  }
}
</style>
