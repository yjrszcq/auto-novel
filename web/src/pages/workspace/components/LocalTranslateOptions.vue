<script lang="ts" setup>
import { InfoOutlined } from '@vicons/material';

const translateLevel = ref<'normal' | 'expire' | 'all'>('expire');
const showRetranslateWarning = computed(() => translateLevel.value === 'all');
const startIndex = ref<number | null>(0);
const endIndex = ref<number | null>(65536);
const taskNumber = ref<number | null>(1);

defineExpose({
  getTranslateTaskParams: () => ({
    level: translateLevel.value,
    forceMetadata: false,
    startIndex: startIndex.value ?? 0,
    endIndex: endIndex.value ?? 65536,
  }),
  getTaskNumber: () => taskNumber.value ?? 1,
});
</script>

<template>
  <n-flex vertical>
    <c-action-wrapper title="翻译级别">
      <n-tooltip placement="top" trigger="hover">
        <template #trigger>
          <c-radio-group
            size="small"
            v-model:value="translateLevel"
            :options="[
              { label: '常规', value: 'normal' },
              { label: '过期', value: 'expire' },
              { label: '重翻', value: 'all' },
            ]"
          />
        </template>
        <div class="local-translate-options__hint">
          <div>常规：只翻译未翻译的章节</div>
          <div>过期：翻译术语表过期的章节</div>
          <div>重翻：重翻全部章节</div>
        </div>
      </n-tooltip>
    </c-action-wrapper>
    <n-text
      v-if="showRetranslateWarning"
      depth="3"
      class="local-translate-options__warning"
    >
      * 请确保你知道自己在干啥，不要随便使用危险功能
    </n-text>
    <c-action-wrapper title="范围">
      <n-flex style="text-align: center" class="local-translate-options__range">
        <div>
          <n-input-group>
            <n-input-group-label size="small">从</n-input-group-label>
            <n-input-number
              size="small"
              v-model:value="startIndex"
              :show-button="false"
              :min="0"
              style="width: 60px"
            />
            <n-input-group-label size="small">到</n-input-group-label>
            <n-input-number
              size="small"
              v-model:value="endIndex"
              :show-button="false"
              :min="0"
              style="width: 60px"
            />
          </n-input-group>
        </div>
        <div class="local-translate-options__task-split">
          <n-input-group>
            <n-input-group-label size="small">均分</n-input-group-label>
            <n-input-number
              size="small"
              v-model:value="taskNumber"
              :show-button="false"
              :min="1"
              style="width: 40px"
            />
            <n-input-group-label size="small">个任务</n-input-group-label>
          </n-input-group>
          <n-tooltip placement="top" trigger="hover">
            <template #trigger>
              <button type="button" class="local-translate-options__info">
                <n-icon :component="InfoOutlined" size="16" />
              </button>
            </template>
            <div class="local-translate-options__hint local-translate-options__hint--range">
              章节序号看下面目录方括号里的数字。“从0到10”表示从第0章到第9章，不包含第10章。均分只对排队生效，最大为10。
            </div>
          </n-tooltip>
        </div>
      </n-flex>
    </c-action-wrapper>
  </n-flex>
</template>

<style scoped>
.local-translate-options__warning {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: #f5d676;
}

.local-translate-options__hint {
  font-size: 14px;
  line-height: 1.5;
  white-space: normal;
  word-break: break-word;
}

.local-translate-options__hint--level {
  max-width: min(80vw, 320px);
}

.local-translate-options__hint--range {
  max-width: min(80vw, 160px);
}

.local-translate-options__range {
  align-items: center;
  gap: 16px;
}

.local-translate-options__task-split {
  display: flex;
  align-items: center;
  gap: 4px;
}

.local-translate-options__info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: help;
  padding: 0;
}

.local-translate-options__info:focus-visible {
  outline: none;
  text-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
}
</style>
