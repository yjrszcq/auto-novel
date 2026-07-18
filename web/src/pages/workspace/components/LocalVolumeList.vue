<script lang="ts" setup>
import { FileDownloadOutlined, MoreVertOutlined } from '@vicons/material';

import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import {
  LocalVolumeManagerUtil,
  useLocalVolumeManager,
} from '@/pages/workspace/LocalVolumeManager';
import { Setting, useSettingStore } from '@/stores';

const props = withDefaults(
  defineProps<{
    options?: { [key: string]: (volumes: LocalVolumeMetadata[]) => void };
    filter?: (volume: LocalVolumeMetadata) => boolean;
    showMenu?: boolean;
  }>(),
  {
    options: undefined,
    filter: undefined,
    showMenu: true,
  },
);

const emit = defineEmits<{
  volumeAdd: [File];
}>();

const message = useMessage();

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

const store = useLocalVolumeManager();
const { volumes } = storeToRefs(store);

store.loadVolumes();

const options = computed(() => {
  return [...Object.keys(props.options ?? {}), '删除'].map((it) => ({
    label: it,
    key: it,
    disabled: selectedVolumes.value.length === 0,
  }));
});
const handleSelect = (key: string) => {
  switch (key) {
    case '删除':
      openDeleteModal();
      break;
    default:
      props.options?.[key]?.(selectedVolumes.value);
      break;
  }
};

const downloadVolumes = async () => {
  const ids = selectedVolumes.value.map((it) => it.id);
  const { success, failed } = await store.downloadVolumes(ids);
  message.info(`${success}本小说已下载，${failed}本失败`);
};

const showDeleteModal = ref(false);

const openDeleteModal = () => {
  showDeleteModal.value = true;
};

const deleteSelectedVolumes = async () => {
  const ids = selectedVolumes.value.map((it) => it.id);
  const { success, failed } = await store.deleteVolumes(ids);
  showDeleteModal.value = false;
  message.info(`${success}本小说被删除，${failed}本失败`);
};

const search = reactive({
  query: '',
  enableRegexMode: false,
});

const sortedVolumes = computed(() => {
  const filteredVolumes =
    props.filter === undefined
      ? volumes.value
      : volumes.value.filter(props.filter);
  return LocalVolumeManagerUtil.filterAndSortVolumes(filteredVolumes, {
    ...search,
    order: setting.value.localVolumeOrder,
  });
});

const selectedVolumeIds = ref(new Set<string>());
const selectedVolumes = computed(() =>
  sortedVolumes.value.filter((volume) =>
    selectedVolumeIds.value.has(volume.id),
  ),
);

watch(sortedVolumes, (currentVolumes) => {
  const visibleIds = new Set(currentVolumes.map((volume) => volume.id));
  selectedVolumeIds.value = new Set(
    [...selectedVolumeIds.value].filter((id) => visibleIds.has(id)),
  );
});

const toggleVolumeSelection = (volumeId: string) => {
  const selected = new Set(selectedVolumeIds.value);
  if (selected.has(volumeId)) selected.delete(volumeId);
  else selected.add(volumeId);
  selectedVolumeIds.value = selected;
};

const selectAllVolumes = () => {
  selectedVolumeIds.value = new Set(
    sortedVolumes.value.map((volume) => volume.id),
  );
};

const invertVolumeSelection = () => {
  const selected = new Set(selectedVolumeIds.value);
  sortedVolumes.value.forEach((volume) => {
    if (selected.has(volume.id)) selected.delete(volume.id);
    else selected.add(volume.id);
  });
  selectedVolumeIds.value = selected;
};

const handleDrawerVisibility = (show: boolean) => {
  if (!show) selectedVolumeIds.value = new Set();
};
</script>

<template>
  <c-drawer-right title="本地小说" @update:show="handleDrawerVisibility">
    <template #action>
      <local-volume-upload-button @done="emit('volumeAdd', $event)" />
      <c-button
        label="下载"
        aria-label="下载选中的书"
        :icon="FileDownloadOutlined"
        :disabled="selectedVolumes.length === 0"
        @action="downloadVolumes"
      />
      <n-dropdown
        v-if="props.showMenu"
        trigger="click"
        :options="options"
        :keyboard="false"
        @select="handleSelect"
      >
        <n-button circle aria-label="更多本地小说操作">
          <n-icon :component="MoreVertOutlined" />
        </n-button>
      </n-dropdown>
    </template>

    <div style="padding: 24px 16px">
      <n-flex vertical>
        <c-action-wrapper title="搜索">
          <search-input
            v-model:value="search"
            placeholder="搜索文件名"
            style="max-width: 400px"
          />
        </c-action-wrapper>

        <c-action-wrapper title="排序" align="center">
          <order-sort
            v-model:value="setting.localVolumeOrder"
            :options="Setting.localVolumeOrderOptions"
          />
        </c-action-wrapper>
        <slot name="extra" :volumes="sortedVolumes ?? []" />
        <c-action-wrapper title="选择" align="center">
          <n-flex align="center" :wrap="true">
            <n-button size="small" @click="selectAllVolumes">全选</n-button>
            <n-button size="small" @click="invertVolumeSelection">
              反选
            </n-button>
            <n-text>已选择 {{ selectedVolumes.length }} 本</n-text>
            <slot name="selection-action" :volumes="selectedVolumes" />
          </n-flex>
        </c-action-wrapper>
      </n-flex>

      <n-divider style="margin: 16px 0 8px" />

      <n-spin v-if="sortedVolumes === undefined" style="margin-top: 20px" />

      <n-empty
        v-else-if="sortedVolumes.length === 0"
        description="没有文件"
        style="margin-top: 20px"
      />

      <n-scrollbar v-else trigger="none" :size="24" style="flex: auto">
        <n-list style="padding-bottom: 48px; padding-right: 12px">
          <n-list-item v-for="volume of sortedVolumes ?? []" :key="volume.id">
            <n-flex align="center" :wrap="false">
              <n-checkbox
                :checked="selectedVolumeIds.has(volume.id)"
                :aria-label="`选择 ${volume.id}`"
                @update:checked="toggleVolumeSelection(volume.id)"
              />
              <div style="min-width: 0; flex: 1">
                <slot name="volume" v-bind="volume" />
              </div>
            </n-flex>
          </n-list-item>
        </n-list>
      </n-scrollbar>

      <c-modal title="删除选中的书" v-model:show="showDeleteModal">
        <n-p>
          这将删除选中的 {{ selectedVolumes.length }}
          本书，包括已经翻译的章节和术语表，无法恢复。 你确定吗？
        </n-p>

        <template #action>
          <c-button
            label="确定"
            type="primary"
            @action="deleteSelectedVolumes"
          />
        </template>
      </c-modal>
    </div>
  </c-drawer-right>
</template>
