<script lang="ts" setup>
import {
  DeleteOutlineOutlined,
  DragIndicatorOutlined,
  FlashOnOutlined,
  PlayArrowOutlined,
  SettingsOutlined,
  StopOutlined,
} from '@vicons/material';

import { Translator, type GptWorkerPipelineSnapshot } from '@/domain/translate';
import type { GptWorker } from '@/model/Translator';

const props = defineProps<{
  worker: GptWorker;
  active: boolean;
  starting: boolean;
  activity?: GptWorkerPipelineSnapshot['workers'][number];
}>();

const emit = defineEmits<{
  start: [GptWorker];
  stop: [string];
  delete: [string];
}>();

const message = useMessage();
const testingTranslator = ref(false);
const showEditWorkerModal = ref(false);

const translatorConfig = computed(
  () =>
    <const>{
      id: 'gpt',
      model: props.worker.model,
      endpoint: props.worker.endpoint,
      key: props.worker.key,
    },
);

const keySuffix = computed(() => props.worker.key.slice(-4));

const testWorker = async () => {
  if (testingTranslator.value || props.active || props.starting) return;
  testingTranslator.value = true;
  const textJp = [
    '国境の長いトンネルを抜けると雪国であった。夜の底が白くなった。信号所に汽車が止まった。',
  ];
  try {
    const translator = await Translator.create(translatorConfig.value);
    const [textZh] = await translator.translate(textJp);
    message.success(`原文：${textJp[0]}\n译文：${textZh}`);
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
      <div class="pool-worker__identity">
        <div class="pool-worker__identity-primary">
          <span class="pool-worker__name">{{ worker.id }}</span>
          <n-text depth="3" class="pool-worker__config">
            {{ worker.model }}[{{ keySuffix }}]
          </n-text>
        </div>
        <n-text depth="3" class="pool-worker__endpoint">
          {{ worker.endpoint }}
        </n-text>
      </div>
    </template>

    <template #header-extra>
      <n-flex :size="6" :wrap="true" justify="end" class="pool-worker__actions">
        <c-button
          v-if="active"
          label="停止"
          :icon="StopOutlined"
          compact-on-mobile
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
          compact-on-mobile
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

  <gpt-worker-modal
    v-if="!active && !starting"
    v-model:show="showEditWorkerModal"
    :worker="worker"
  />
</template>

<style scoped>
.pool-worker__identity {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
}

.pool-worker__identity-primary {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
}

.pool-worker__config,
.pool-worker__endpoint {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.n-thing-avatar) {
  display: flex;
  align-self: center;
  align-items: center;
  margin-top: 0;
}

@media (max-width: 639px) {
  .pool-worker__identity {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }

  .pool-worker__identity-primary {
    flex-wrap: wrap;
  }

  .pool-worker__name {
    font-weight: 600;
  }

  .pool-worker__config,
  .pool-worker__endpoint {
    font-size: 12px;
  }

  .pool-worker__actions {
    display: grid !important;
    grid-template-columns: repeat(2, max-content);
    justify-content: end !important;
    gap: 6px !important;
  }
}
</style>
