import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

interface RuntimeConfigPayload {
  logoImage?: string;
  homeBackgroundImage?: string;
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
      logoImage: payload.logoImage?.trim() ?? '',
      homeBackgroundImage: payload.homeBackgroundImage?.trim() ?? '',
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

  const resolveImageSource = (source: string) =>
    /^https?:\/\//i.test(source) ? source : getLocalConfigFileUrl(source);

  const logoImage = computed(() =>
    resolveImageSource(config.value?.logoImage?.trim() ?? ''),
  );

  const hasLogoImage = computed(() => logoImage.value.length > 0);

  const homeBackgroundImage = computed(() =>
    resolveImageSource(config.value?.homeBackgroundImage?.trim() ?? ''),
  );

  return {
    config,
    loading,
    loaded,
    error,
    loadRuntimeConfig,
    logoImage,
    hasLogoImage,
    homeBackgroundImage,
  };
});
