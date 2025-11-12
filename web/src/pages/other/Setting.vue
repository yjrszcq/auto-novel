<script lang="ts" setup>
import SoundAllTaskCompleted from '@/sound/all_task_completed.mp3';
import { Setting, useSettingStore } from '@/stores';

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);

const playSound = (source: string) => {
  return new Audio(source).play();
};
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
            <n-li>GPT/Sakura 排队按钮，按住 Ctrl 键点击，会将任务自动置顶。</n-li>
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
