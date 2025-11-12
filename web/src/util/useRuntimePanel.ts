import { onMounted, ref } from 'vue';

export const useRuntimePanel = (filename: string) => {
  const html = ref<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch(`/panel-content/${filename}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        html.value = null;
        return;
      }
      const content = (await response.text()).trim();
      html.value = content.length > 0 ? content : null;
    } catch (error) {
      console.warn(`加载运行时公告(${filename})失败`, error);
      html.value = null;
    }
  };

  onMounted(load);

  return { html, reload: load };
};
