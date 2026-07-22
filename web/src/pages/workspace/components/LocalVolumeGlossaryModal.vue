<script lang="ts" setup>
import type { Glossary } from '@/model/Glossary';
import { useLocalVolumeStore } from '@/stores';
import type { ParsedFile } from '@/util/file';
import { parseFile } from '@/util/file';

const props = defineProps<{
  show: boolean;
  volumeId: string;
}>();
const emit = defineEmits<{
  'update:show': [boolean];
}>();

const message = useMessage();
const loading = ref(false);
const applying = ref(false);
const error = ref('');
const initialGlossary = shallowRef<Glossary>({});
const initialCandidateCounts = shallowRef<Record<string, number>>();
const initialExcludedWords = shallowRef<string[]>([]);
const emptyFiles: ParsedFile[] = [];
let loadRequest = 0;
let candidateSave = Promise.resolve();

const loadVolume = async () => {
  const request = ++loadRequest;
  loading.value = true;
  error.value = '';
  try {
    const repository = await useLocalVolumeStore();
    const volume = await repository.getVolume(props.volumeId);
    if (volume === undefined) throw new Error('小说不存在');
    if (request !== loadRequest || !props.show) return;
    initialGlossary.value = { ...volume.glossary };
    initialCandidateCounts.value =
      volume.glossaryCandidateCounts === undefined
        ? undefined
        : { ...volume.glossaryCandidateCounts };
    initialExcludedWords.value = [...(volume.glossaryExcludedWords ?? [])];
  } catch (reason) {
    if (request === loadRequest && props.show) error.value = String(reason);
  } finally {
    if (request === loadRequest) loading.value = false;
  }
};

watch(
  () => props.show,
  (show) => {
    if (show) void loadVolume();
    else loadRequest += 1;
  },
  { immediate: true },
);

const loadFiles = async () => {
  const repository = await useLocalVolumeStore();
  const stored = await repository.getFile(props.volumeId);
  if (stored === undefined) throw new Error('原始书籍文件不存在');
  return [await parseFile(stored.file)];
};

const saveCandidates = (candidateCounts: Record<string, number>) => {
  candidateSave = candidateSave.then(async () => {
    try {
      const repository = await useLocalVolumeStore();
      await repository.updateGlossaryCandidates(
        props.volumeId,
        candidateCounts,
      );
      initialCandidateCounts.value = { ...candidateCounts };
    } catch (reason) {
      message.error(`无法保存扫描结果：${String(reason)}`);
    }
  });
  return candidateSave;
};

const applyGlossary = async (glossary: Glossary, excludedWords: string[]) => {
  if (applying.value) return;
  applying.value = true;
  try {
    await candidateSave;
    const repository = await useLocalVolumeStore();
    await repository.updateGlossary(props.volumeId, glossary, excludedWords);
    await repository.deleteReaderAutomaticTranslationCaches({
      bookId: props.volumeId,
    });
    emit('update:show', false);
    message.success('术语表已保存到本书');
  } catch (reason) {
    message.error(`无法保存术语表：${String(reason)}`);
  } finally {
    applying.value = false;
  }
};
</script>

<template>
  <c-modal
    :show="show"
    title="编辑术语表"
    @update:show="emit('update:show', $event)"
  >
    <div v-if="loading" class="local-volume-glossary-modal__loading">
      <n-spin size="medium" />
      <span>正在读取术语表…</span>
    </div>
    <n-alert v-else-if="error" type="error">加载失败：{{ error }}</n-alert>
    <Suspense v-else>
      <ToolboxItemGlossary
        :files="emptyFiles"
        :load-files="loadFiles"
        :initial-glossary="initialGlossary"
        :initial-candidate-counts="initialCandidateCounts"
        :initial-excluded-words="initialExcludedWords"
        :initial-minimum-count="10"
        auto-scan-if-empty
        :applying="applying"
        apply-label="保存到本书"
        @apply="applyGlossary"
        @scan="saveCandidates"
      />
      <template #fallback>
        <div class="local-volume-glossary-modal__loading">
          <n-spin size="medium" />
          <span>正在加载术语表工具…</span>
        </div>
      </template>
    </Suspense>
  </c-modal>
</template>

<style scoped>
.local-volume-glossary-modal__loading {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
</style>
