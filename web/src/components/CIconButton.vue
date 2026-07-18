<script lang="ts" setup>
defineProps<{
  tooltip?: string;
  icon?: Component;
  iconHidden?: boolean;
}>();

const attrs = useAttrs();
const secondary = computed(
  () => !('text' in attrs) && !('ghost' in attrs) && !('dashed' in attrs),
);
</script>

<template>
  <template v-if="tooltip">
    <n-tooltip trigger="hover">
      <template #trigger>
        <c-button
          size="tiny"
          :icon="icon"
          :icon-hidden="iconHidden"
          :secondary="secondary"
          circle
          v-bind="$attrs"
        />
      </template>
      {{ tooltip }}
    </n-tooltip>
  </template>

  <c-button
    v-else
    size="tiny"
    :icon="icon"
    :icon-hidden="iconHidden"
    :secondary="secondary"
    circle
    v-bind="$attrs"
  />
</template>
