import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

interface RuntimeConfigPayload {
  logoImageUrl?: string;
  logoImageFile?: string;
  homeBackgroundImageUrl?: string;
  homeBackgroundImageFile?: string;
}

export const useRuntimeConfigStore = defineStore('runtime-config', () => {
  const config = ref<RuntimeConfigPayload | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  let loadPromise: Promise<void> | null = null;

  const applyConfig = (payload: RuntimeConfigPayload | null) => {
    if (payload === null) {
      config.value = null;
      return;
    }
    config.value = {
      logoImageUrl: payload.logoImageUrl?.trim() ?? '',
      logoImageFile: payload.logoImageFile?.trim() ?? '',
      homeBackgroundImageUrl: payload.homeBackgroundImageUrl?.trim() ?? '',
      homeBackgroundImageFile: payload.homeBackgroundImageFile?.trim() ?? '',
    };
  };

  const loadRuntimeConfig = async (forceReload = false) => {
    if (loading.value) {
      return loadPromise;
    }
    if (loaded.value && !forceReload) {
      return loadPromise;
    }

    loading.value = true;
    loadPromise = (async () => {
      try {
        const response = await fetch('/api/runtime-config', {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`获取运行时配置失败：HTTP ${response.status}`);
        }
        const data = (await response.json()) as RuntimeConfigPayload;
        applyConfig(data);
        loaded.value = true;
        error.value = null;
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        if (!loaded.value || config.value === null) {
          applyConfig(null);
        }
      } finally {
        loading.value = false;
        loadPromise = null;
      }
    })();

    return loadPromise;
  };

  const getLocalConfigFileUrl = (filename: string) => {
    const segments = filename
      .split('/')
      .filter((segment) => segment.length > 0);
    if (
      segments.length === 0 ||
      segments.some((segment) => segment === '.' || segment === '..')
    ) {
      return '';
    }
    return `/panel-content/${segments.map(encodeURIComponent).join('/')}`;
  };

  const logoImageUrl = computed(() => config.value?.logoImageUrl?.trim() ?? '');

  const logoImageFile = computed(
    () => config.value?.logoImageFile?.trim() ?? '',
  );

  const logoImage = computed(
    () => getLocalConfigFileUrl(logoImageFile.value) || logoImageUrl.value,
  );

  const hasLogoImage = computed(() => logoImage.value.length > 0);

  const homeBackgroundImageUrl = computed(
    () => config.value?.homeBackgroundImageUrl?.trim() ?? '',
  );

  const homeBackgroundImageFile = computed(
    () => config.value?.homeBackgroundImageFile?.trim() ?? '',
  );

  const homeBackgroundImage = computed(() => {
    return (
      getLocalConfigFileUrl(homeBackgroundImageFile.value) ||
      homeBackgroundImageUrl.value
    );
  });

  return {
    config,
    loading,
    loaded,
    error,
    loadRuntimeConfig,
    logoImageUrl,
    logoImage,
    hasLogoImage,
    homeBackgroundImageUrl,
    homeBackgroundImage,
  };
});
