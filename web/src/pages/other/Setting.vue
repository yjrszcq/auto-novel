<script lang="ts" setup>
import type { ReaderMode, ReaderSettingsRecord } from '@/model/Reader';
import { readerModeLabels } from '../reader/core/ReaderMode';
import {
  defaultReaderSettings,
  normalizeReaderAutoTranslationPreloadPages,
  normalizeReaderSettings,
  serializeReaderSettings,
} from '../reader/core/ReaderSettings';
import SoundAllTaskCompleted from '@/sound/all_task_completed.mp3';

import { Setting, useLocalVolumeStore, useSettingStore } from '@/stores';

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);
const message = useMessage();
const readerSettings = ref<ReaderSettingsRecord>({ ...defaultReaderSettings });
const readerSettingsLoading = ref(true);
const readerSettingsSaving = ref(false);
const readerRepositoryPromise = useLocalVolumeStore();

const readerModeOptions: { label: string; value: ReaderMode }[] = [
  { label: '中文', value: 'translated' },
  { label: '中日', value: 'translated-original' },
  { label: '日中', value: 'original-translated' },
  { label: '原文', value: 'original' },
];
const playSound = (source: string) => {
  return new Audio(source).play();
};

const loadReaderSettings = async () => {
  readerSettingsLoading.value = true;
  try {
    const repository = await readerRepositoryPromise;
    readerSettings.value = normalizeReaderSettings(
      await repository.getReaderSettings(),
    );
  } catch {
    message.warning('无法读取阅读偏好，已使用默认值');
  } finally {
    readerSettingsLoading.value = false;
  }
};

const isReaderMode = (value: string | number): value is ReaderMode =>
  typeof value === 'string' && value in readerModeLabels;

const persistReaderSettings = async (
  update: (current: ReaderSettingsRecord) => ReaderSettingsRecord,
) => {
  if (readerSettingsLoading.value || readerSettingsSaving.value) return;
  const previous = readerSettings.value;
  const next = { ...update(previous), updatedAt: Date.now() };
  readerSettings.value = next;
  readerSettingsSaving.value = true;
  try {
    const repository = await readerRepositoryPromise;
    await repository.putReaderSettings(serializeReaderSettings(next));
  } catch {
    readerSettings.value = previous;
    message.error('无法保存阅读偏好');
  } finally {
    readerSettingsSaving.value = false;
  }
};

const updateDefaultReaderMode = (value: string | number) => {
  if (!isReaderMode(value)) return;
  void persistReaderSettings((current) => ({
    ...current,
    defaultMode: value,
  }));
};

const updateAutoTranslationPreloadPages = (value: number | null) => {
  void persistReaderSettings((current) => ({
    ...current,
    autoTranslationPreloadPages:
      normalizeReaderAutoTranslationPreloadPages(value),
  }));
};

onMounted(() => {
  void loadReaderSettings();
});
</script>

<template>
  <div class="layout-content">
    <n-h1>设置</n-h1>

    <n-list bordered>
      <n-list-item>
        <n-flex vertical>
          <b>主题</b>
          <c-radio-group
            v-model:value="setting.theme"
            :options="Setting.themeOptions"
            size="small"
          />
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>快捷键说明</b>
          <n-ul>
            <n-li>阅读页面，可以使用左右方向键跳转上/下一章。</n-li>
            <n-li>
              阅读页面，可以使用数字键 1～4
              快速切换翻译（中文/中日/日中/原文）。
            </n-li>
            <n-li>
              GPT/Sakura 排队按钮，按住 Ctrl 键点击，会将任务自动置顶。
            </n-li>
          </n-ul>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>首页</b>
          <c-action-wrapper title="下载语言">
            <c-radio-group
              v-model:value="setting.homeDownloadMode"
              :options="Setting.downloadModeOptions"
              size="small"
            />
          </c-action-wrapper>
          <c-action-wrapper title="优先下载">
            <c-radio-group
              v-model:value="setting.homeDownloadPriority"
              :options="Setting.homeDownloadPriorityOptions"
              size="small"
            />
          </c-action-wrapper>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>工作区</b>
          <n-checkbox v-model:checked="setting.autoTopJobWhenAddTask">
            工作区添加时自动置顶
          </n-checkbox>
          <n-flex :wrap="false" :size="0">
            <n-checkbox v-model:checked="setting.workspaceSound">
              任务全部完成时语音提醒
            </n-checkbox>

            [
            <c-button
              label="点击播放"
              text
              type="primary"
              @action="playSound(SoundAllTaskCompleted)"
            />
            ]
          </n-flex>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>本地 EPUB 下载</b>
          <n-checkbox v-model:checked="setting.embedMetadataInOriginalDownload">
            原文下载时展示信息嵌入元数据
          </n-checkbox>
          <n-checkbox
            v-model:checked="setting.embedMetadataInTranslatedDownload"
          >
            译文下载时展示信息嵌入元数据
          </n-checkbox>
          <n-text depth="3">
            仅修改下载副本，浏览器中保存的原始 EPUB 不会改变。
          </n-text>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical :size="8">
          <b>阅读</b>
          <c-action-wrapper title="阅读偏好">
            <c-radio-group
              id="reader-default-mode"
              size="small"
              :aria-busy="readerSettingsLoading"
              :value="readerSettings.defaultMode"
              :options="readerModeOptions"
              @update:value="updateDefaultReaderMode"
            />
          </c-action-wrapper>
          <c-action-wrapper title="自动翻译预翻译">
            <n-flex vertical :size="4">
              <n-input-number
                :value="readerSettings.autoTranslationPreloadPages"
                :min="0"
                :max="20"
                :precision="0"
                :input-props="{
                  'aria-label': '自动翻译预翻译页数',
                }"
                :disabled="readerSettingsLoading || readerSettingsSaving"
                @update:value="updateAutoTranslationPreloadPages"
              />
              <n-text depth="3">
                提前翻译当前页之后的页数；0 表示只处理当前可见页。
              </n-text>
            </n-flex>
          </c-action-wrapper>
        </n-flex>
      </n-list-item>
    </n-list>
  </div>
</template>
