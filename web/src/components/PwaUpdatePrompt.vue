<script lang="ts" setup>
import { useRegisterSW } from 'virtual:pwa-register/vue';

const message = useMessage();
const updating = ref(false);

const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
  immediate: true,
  onRegisterError(error) {
    console.error('PWA Service Worker 注册失败', error);
  },
});

watch(offlineReady, (ready) => {
  if (ready) message.success('应用已可离线使用');
});

const applyUpdate = async () => {
  updating.value = true;
  try {
    await updateServiceWorker(true);
  } catch (error) {
    updating.value = false;
    message.error('更新失败，请稍后重试');
    console.error('PWA 更新失败', error);
  }
};
</script>

<template>
  <n-alert
    v-if="needRefresh"
    class="pwa-update-prompt"
    title="应用有新版本"
    type="info"
    closable
    @close="needRefresh = false"
  >
    更新将在重新加载后生效。请先确认没有正在进行的翻译。
    <template #action>
      <n-button
        type="primary"
        :loading="updating"
        :disabled="updating"
        @click="applyUpdate"
      >
        立即更新
      </n-button>
    </template>
  </n-alert>
</template>

<style scoped>
.pwa-update-prompt {
  position: fixed;
  z-index: 5000;
  right: max(20px, env(safe-area-inset-right));
  bottom: max(20px, env(safe-area-inset-bottom));
  width: min(420px, calc(100vw - 40px));
  box-shadow: 0 8px 28px rgb(0 0 0 / 28%);
}

@media (max-width: 639px) {
  .pwa-update-prompt {
    right: max(12px, env(safe-area-inset-right));
    bottom: max(12px, env(safe-area-inset-bottom));
    width: min(420px, calc(100vw - 24px));
  }
}
</style>
