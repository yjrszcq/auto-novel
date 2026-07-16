<script lang="ts" setup>
import type { ReaderMode, ReaderSettingsRecord } from '@/model/Reader';
import { readerModeLabels } from '../reader/core/ReaderMode';
import {
  defaultReaderSettings,
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

const readerModeOptions = (Object.keys(readerModeLabels) as ReaderMode[]).map(
  (value) => ({ label: readerModeLabels[value], value }),
);
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

const updateDefaultReaderMode = async (value: string | number) => {
  if (!isReaderMode(value) || readerSettingsSaving.value) {
    return;
  }
  const previous = readerSettings.value;
  const next = {
    ...previous,
    defaultMode: value,
    updatedAt: Date.now(),
  };
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
        <n-flex vertical :size="8">
          <b>阅读</b>
          <label for="reader-default-mode">默认阅读版本</label>
          <n-select
            id="reader-default-mode"
            :aria-busy="readerSettingsLoading"
            :value="readerSettings.defaultMode"
            :options="readerModeOptions"
            :loading="readerSettingsLoading"
            :disabled="readerSettingsLoading || readerSettingsSaving"
            @update:value="updateDefaultReaderMode"
          />
          <n-text depth="3">
            中文和双语模式有可用译文时按所选方式打开；没有译文时始终显示原文（日文）。
          </n-text>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>快捷键说明</b>
          <n-ul>
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
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>工作区语音提醒</b>
          <n-flex :wrap="false" :size="0">
            <n-checkbox v-model:checked="setting.workspaceSound">
              任务全部完成
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
    </n-list>
  </div>
</template>
