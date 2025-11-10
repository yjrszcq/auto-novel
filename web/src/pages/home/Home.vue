<script lang="ts" setup>
import { WorkspacesOutlined } from '@vicons/material';

import bannerUrl from '@/image/banner.webp';
import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import type { TranslateJobRecord } from '@/model/Translator';
import { useLocalVolumeStore, useWorkspaceStore } from '@/stores';
import { useBreakPoints } from '@/pages/util';

const bp = useBreakPoints();
const showShortcut = bp.smaller('tablet');

const vars = useThemeVars();

const keyword = ref('');
const infoPanelHtml = ref<string | null>(null);

const quickActions = [
  { label: '小说工具箱', to: '/workspace/toolbox', icon: WorkspacesOutlined },
  { label: 'GPT工作区', to: '/workspace/gpt', icon: WorkspacesOutlined },
  { label: 'Sakura工作区', to: '/workspace/sakura', icon: WorkspacesOutlined },
  { label: '交互翻译', to: '/workspace/interactive', icon: WorkspacesOutlined },
];

const loadInfoPanel = async () => {
  try {
    const response = await fetch('/panel-content/info.html', {
      cache: 'no-store',
    });
    if (!response.ok) {
      infoPanelHtml.value = null;
      return;
    }
    const content = (await response.text()).trim();
    infoPanelHtml.value = content.length > 0 ? content : null;
  } catch (error) {
    console.warn('加载说明面板失败', error);
    infoPanelHtml.value = null;
  }
};

onMounted(loadInfoPanel);

const localRepo = shallowRef<Awaited<ReturnType<typeof useLocalVolumeStore>>>();
const ensureLocalRepo = async () => {
  if (!localRepo.value) {
    localRepo.value = await useLocalVolumeStore();
  }
  return localRepo.value;
};

const gptWorkspace = useWorkspaceStore('gpt');
const sakuraWorkspace = useWorkspaceStore('sakura');
const gptRecordsSource = computed(
  () => gptWorkspace.ref.value.uncompletedJobs,
);
const sakuraRecordsSource = computed(
  () => sakuraWorkspace.ref.value.uncompletedJobs,
);

interface SearchResult {
  keyword: string;
  volumes: LocalVolumeMetadata[];
  gptRecords: TranslateJobRecord[];
  sakuraRecords: TranslateJobRecord[];
}

const searchResults = ref<SearchResult | null>(null);
const searchState = reactive({ loading: false, error: null as string | null });
const showSearchPanel = computed(() => keyword.value.trim().length > 0);

const filterRecords = (
  records: TranslateJobRecord[],
  keywordLower: string,
) => {
  return records.filter((record) => {
    const text = `${record.task} ${record.description ?? ''}`.toLowerCase();
    return text.includes(keywordLower);
  });
};

const handleSearch = async () => {
  const query = keyword.value.trim();
  if (query.length === 0) {
    searchResults.value = null;
    searchState.error = null;
    return;
  }
  searchState.loading = true;
  searchState.error = null;
  const lower = query.toLowerCase();
  try {
    const repo = await ensureLocalRepo();
    const volumes = await repo.listVolume();
    const volumeMatches = volumes.filter((volume) =>
      volume.id.toLowerCase().includes(lower),
    );
    searchResults.value = {
      keyword: query,
      volumes: volumeMatches,
      gptRecords: filterRecords(gptRecordsSource.value, lower),
      sakuraRecords: filterRecords(sakuraRecordsSource.value, lower),
    };
  } catch (error) {
    searchState.error = `${error}`;
  } finally {
    searchState.loading = false;
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
          placeholder="输入小说文件名或任务描述，搜索上传的小说与缓存的翻译"
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

    <n-card v-if="showSearchPanel" class="search-result-card" size="small">
      <template #header>
        <n-text>
          {{
            searchResults ? `搜索：${searchResults.keyword}` : '搜索结果'
          }}
        </n-text>
      </template>

      <n-skeleton v-if="searchState.loading" text :repeat="3" />

      <n-alert
        v-else-if="searchState.error"
        type="error"
        :title="'搜索失败'"
      >
        {{ searchState.error }}
      </n-alert>

      <n-empty v-else-if="!searchResults" description="点击搜索以开始查询" />

      <template v-else>
        <n-space vertical :size="16">
          <div>
            <n-h3>上传的小说</n-h3>
            <n-empty
              v-if="searchResults.volumes.length === 0"
              description="没有匹配的小说"
            />
            <n-list v-else>
              <n-list-item
                v-for="volume in searchResults.volumes"
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
                </n-thing>
              </n-list-item>
            </n-list>
          </div>

          <div>
            <n-h3>缓存的翻译</n-h3>
            <n-empty
              v-if="
                searchResults.gptRecords.length === 0 &&
                searchResults.sakuraRecords.length === 0
              "
              description="没有匹配的任务"
            />
            <template v-else>
              <div class="record-group">
                <n-h4>GPT 工作区</n-h4>
                <n-empty
                  v-if="searchResults.gptRecords.length === 0"
                  size="small"
                  description="未找到任务"
                />
                <n-list v-else>
                  <n-list-item
                    v-for="record in searchResults.gptRecords"
                    :key="`${record.task}-gpt`"
                  >
                    <n-thing :title="record.description || '未命名任务'">
                      <template #description>
                        <n-text depth="3">
                          {{ record.task }}
                        </n-text>
                      </template>
                      <template #footer>
                        <n-text depth="3">请前往 GPT 工作区执行操作</n-text>
                      </template>
                    </n-thing>
                  </n-list-item>
                </n-list>
              </div>

              <div class="record-group">
                <n-h4>Sakura 工作区</n-h4>
                <n-empty
                  v-if="searchResults.sakuraRecords.length === 0"
                  size="small"
                  description="未找到任务"
                />
                <n-list v-else>
                  <n-list-item
                    v-for="record in searchResults.sakuraRecords"
                    :key="`${record.task}-sakura`"
                  >
                    <n-thing :title="record.description || '未命名任务'">
                      <template #description>
                        <n-text depth="3">
                          {{ record.task }}
                        </n-text>
                      </template>
                      <template #footer>
                        <n-text depth="3">请前往 Sakura 工作区执行操作</n-text>
                      </template>
                    </n-thing>
                  </n-list-item>
                </n-list>
              </div>
            </template>
          </div>
        </n-space>
      </template>
    </n-card>

    <job-record-section
      id="gpt"
      title="GPT工作区任务记录"
      :enable-retry="false"
      redirect-to="/workspace/gpt"
    />

    <n-divider />

    <job-record-section
      id="sakura"
      title="Sakura工作区任务记录"
      :enable-retry="false"
      redirect-to="/workspace/sakura"
    />
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
