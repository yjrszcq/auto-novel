<script lang="ts" setup>
import {
  DeleteOutlineOutlined,
  DragIndicatorOutlined,
  FlashOnOutlined,
  PlayArrowOutlined,
  SettingsOutlined,
  StopOutlined,
} from '@vicons/material';

import {
  Translator,
  type SakuraWorkerPipelineSnapshot,
} from '@/domain/translate';
import type { SakuraWorker } from '@/model/Translator';

const props = defineProps<{
  worker: SakuraWorker;
  active: boolean;
  starting: boolean;
  activity?: SakuraWorkerPipelineSnapshot['workers'][number];
  error?: string;
}>();

const emit = defineEmits<{
  start: [SakuraWorker];
  stop: [string];
  delete: [string];
}>();

const message = useMessage();
const testingTranslator = ref(false);
const showEditWorkerModal = ref(false);

const translatorConfig = computed(
  () =>
    <const>{
      id: 'sakura',
      endpoint: props.worker.endpoint,
      segLength: props.worker.segLength,
      prevSegLength: props.worker.prevSegLength,
    },
);

const endpointPrefix = computed(() => `${props.worker.segLength}@`);

const testWorker = async () => {
  if (testingTranslator.value || props.active || props.starting) return;
  testingTranslator.value = true;
  const textJp = [
    '国境の長いトンネルを抜けると雪国であった。夜の底が白くなった。信号所に汽車が止まった。',
  ];
  try {
    const translator = await Translator.create(translatorConfig.value);
    const [textZh] = await translator.translate(textJp);
    message.success(
      `原文：${textJp[0]}\n译文：${textZh}\n模型：${translator.sakuraModel()}`,
    );
  } catch (error) {
    message.error(`翻译器错误：${error}`);
  } finally {
    testingTranslator.value = false;
  }
};
</script>

<template>
  <n-thing content-indented>
    <template #avatar>
      <n-icon
        class="drag-trigger"
        :size="18"
        :depth="2"
        :component="DragIndicatorOutlined"
        style="cursor: move"
      />
    </template>

    <template #header>
      {{ worker.id }}
      <n-text depth="3" style="font-size: 12px; padding-left: 2px">
        {{ endpointPrefix }}{{ worker.endpoint }}
      </n-text>
    </template>

    <template #description>
      <n-flex v-if="starting || error" vertical :size="2">
        <n-text v-if="starting" depth="3" style="font-size: 12px">
          正在连接并检测模型
        </n-text>
        <n-text v-if="error" type="error" style="font-size: 12px">
          启动失败：{{ error }}
        </n-text>
      </n-flex>
    </template>

    <template #header-extra>
      <n-flex :size="6" :wrap="true" justify="end">
        <c-button
          v-if="active"
          label="停止"
          :icon="StopOutlined"
          size="tiny"
          secondary
          @action="emit('stop', worker.id)"
        />
        <c-button
          v-else
          label="启动"
          :icon="PlayArrowOutlined"
          :disabled="starting"
          :icon-hidden="starting"
          size="tiny"
          secondary
          @action="emit('start', worker)"
        />

        <c-icon-button
          tooltip="测试"
          :icon="FlashOnOutlined"
          :disabled="active || starting"
          :icon-hidden="testingTranslator"
          @action="testWorker"
        />

        <c-icon-button
          tooltip="设置（请先停止）"
          :icon="SettingsOutlined"
          :disabled="active || starting"
          @action="showEditWorkerModal = true"
        />

        <c-icon-button
          tooltip="删除"
          :icon="DeleteOutlineOutlined"
          :disabled="starting"
          type="error"
          @action="emit('delete', worker.id)"
        />
      </n-flex>
    </template>
  </n-thing>

  <sakura-worker-modal
    v-if="!active && !starting"
    v-model:show="showEditWorkerModal"
    :worker="worker"
  />
</template>
