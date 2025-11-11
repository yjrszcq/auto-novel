<script lang="ts" setup>
const translateLevel = ref<'normal' | 'expire' | 'all'>('expire');
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
      <c-radio-group
        size="small"
        v-model:value="translateLevel"
        :options="[
          { label: '常规', value: 'normal' },
          { label: '过期', value: 'expire' },
          { label: '重翻', value: 'all' },
        ]"
      />
    </c-action-wrapper>
    <c-action-wrapper title="范围">
      <n-flex style="text-align: center">
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
        <div>
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
        </div>
      </n-flex>
    </c-action-wrapper>
  </n-flex>
</template>
