<script lang="ts" setup>
defineProps<{ title: string }>();
const slots = useSlots();
</script>

<template>
  <n-flex
    align="baseline"
    justify="space-between"
    :wrap="false"
    style="width: 100"
  >
    <n-flex v-if="slots['title-action']" align="center" :wrap="false">
      <n-h2 prefix="bar">{{ title }}</n-h2>
      <slot name="title-action" />
    </n-flex>
    <n-h2 v-else prefix="bar">{{ title }}</n-h2>
    <n-flex :wrap="false">
      <slot />
    </n-flex>
  </n-flex>
</template>
