<script lang="ts" setup>
const props = defineProps<{
  label?: string;
  icon?: Component;
  iconHidden?: boolean;
  onAction?: (e: MouseEvent) => unknown;
}>();

const message = useMessage();

const running = ref(false);

const onClick = async (e: MouseEvent) => {
  if (!props.onAction) return;

  if (running.value) {
    message.warning('处理中...');
    return;
  }
  const ret = props.onAction(e);
  if (ret instanceof Promise) {
    try {
      running.value = true;
      await ret;
    } finally {
      running.value = false;
    }
  }
};
</script>

<template>
  <n-button
    round
    class="c-button"
    :loading="!icon && running"
    @click="onClick"
    v-bind="$attrs"
  >
    <template v-if="icon && label" #icon>
      <span class="c-button__icon-wrapper">
        <n-icon
          :class="{ 'c-button__icon--hidden': props.iconHidden }"
          :component="icon"
        />
        <span v-if="running" class="c-button__spinner" aria-hidden="true" />
      </span>
    </template>
    {{ label }}
    <template v-if="icon && !label">
      <span class="c-button__icon-wrapper c-button__icon-wrapper--solo">
        <n-icon
          :class="{ 'c-button__icon--hidden': props.iconHidden }"
          :component="icon"
        />
        <span v-if="running" class="c-button__spinner" aria-hidden="true" />
      </span>
    </template>
  </n-button>
</template>

<style scoped>
.c-button__icon-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.c-button__icon-wrapper--solo {
  width: 1.25em;
  height: 1.25em;
}

.c-button__icon--hidden {
  opacity: 0;
}

.c-button__spinner {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  animation: c-button-spin 0.6s linear infinite;
}

@keyframes c-button-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
