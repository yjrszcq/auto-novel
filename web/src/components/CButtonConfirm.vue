<script lang="ts" setup>
defineProps<{
  hint: string;
  label?: string;
  icon?: Component;
  compactOnMobile?: boolean;
  onAction?: (e: MouseEvent) => unknown;
}>();
</script>

<template>
  <n-popconfirm
    :show-icon="false"
    @positive-click="onAction"
    :negative-text="null"
    style="max-width: 300px"
  >
    <template #trigger>
      <n-button
        :aria-label="label || hint"
        round
        :class="{
          'c-button-confirm--compact-on-mobile': compactOnMobile,
        }"
        v-bind="$attrs"
      >
        <template v-if="icon && label" #icon>
          <n-icon :component="icon" />
        </template>
        <span v-if="label" class="c-button-confirm__label">{{ label }}</span>
        <template v-if="icon && !label">
          <n-icon :component="icon" />
        </template>
      </n-button>
    </template>
    {{ hint }}
  </n-popconfirm>
</template>

<style scoped>
@media (max-width: 639px) {
  .c-button-confirm--compact-on-mobile {
    width: var(--n-height);
    padding: 0;
  }

  .c-button-confirm--compact-on-mobile .c-button-confirm__label {
    display: none;
  }
}
</style>
