<script lang="ts" setup>
import { useRuntimeConfigStore } from '@/stores';

const runtimeConfigStore = useRuntimeConfigStore();
const { logoImageUrl } = storeToRefs(runtimeConfigStore);
const canShowLogo = computed(() => logoImageUrl.value.length > 0);
</script>

<template>
  <n-drawer :width="280" :auto-focus="false" placement="left">
    <n-drawer-content
      :native-scrollbar="false"
      :scrollbar-props="{ trigger: 'none' }"
      header-style="height: 100px; padding: 0"
    >
      <template #header>
        <div
          style="
            position: absolute;
            width: 100%;
            height: 100px;
            top: 0;
            background: #41a782;
          "
        />
        <img
          v-if="canShowLogo"
          :src="logoImageUrl"
          style="position: absolute; top: 0; height: 120px; margin: 8px 0 0 8px"
          alt="logo"
        />
      </template>
      <div style="margin-top: 36px">
        <slot />
      </div>
    </n-drawer-content>
  </n-drawer>
</template>
