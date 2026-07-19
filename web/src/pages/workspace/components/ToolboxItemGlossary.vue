<script lang="ts" setup>
import { DeleteOutlineOutlined } from '@vicons/material';

import type { TranslatorConfig } from '@/domain/translate';
import { Translator } from '@/domain/translate';
import { Glossary } from '@/model/Glossary';
import { useGptWorkspaceStore, useSakuraWorkspaceStore } from '@/stores';
import { downloadFile } from '@/util';
import type { ParsedFile } from '@/util/file';

import {
  countKatakanaTerms,
  filterGlossaryCandidates,
  mergeAutomaticTranslations,
  mergeGlossaryCounts,
  translateGlossaryWords,
  type GlossarySort,
  type GlossaryTranslationProgress,
} from './ToolboxGlossary';

const props = defineProps<{
  files: ParsedFile[];
}>();

const message = useMessage();
const gptWorkspace = useGptWorkspaceStore().ref;
const sakuraWorkspace = useSakuraWorkspaceStore().ref;
const selectedGptWorkerId = ref(gptWorkspace.value.workers[0]?.id);
const selectedSakuraWorkerId = ref(sakuraWorkspace.value.workers[0]?.id);
const gptWorkerOptions = computed(() =>
  gptWorkspace.value.workers.map(({ id, model }) => ({
    label: `${id} · ${model}`,
    value: id,
  })),
);
const sakuraWorkerOptions = computed(() =>
  sakuraWorkspace.value.workers.map(({ id, endpoint }) => ({
    label: `${id} · ${endpoint}`,
    value: id,
  })),
);
const showTranslatorConfigModal = ref(false);
const sourceCounts = shallowRef(new Map<string, number>());
const extractionLoading = ref(false);
const extractionError = ref('');
const minimumCount = ref(10);
const query = ref('');
const sort = ref<GlossarySort>('count-desc');
const sortOptions = [
  { label: '频次降序', value: 'count-desc' },
  { label: '频次升序', value: 'count-asc' },
  { label: '词语升序', value: 'word-asc' },
  { label: '词语降序', value: 'word-desc' },
];
const deletedWords = shallowRef(new Set<string>());
const deletionHistory = ref<string[][]>([]);
const selectedWords = ref<string[]>([]);
const translations = ref<Record<string, string>>({});
const manuallyEdited = shallowRef(new Set<string>());
const translationFailures = shallowRef(new Map<string, unknown>());
const translating = ref(false);
const translationProgress = ref<GlossaryTranslationProgress>({
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  currentWord: '',
});
let extractionRequest = 0;
let translationController: AbortController | undefined;

const activeCandidates = computed(() =>
  filterGlossaryCandidates(sourceCounts.value, {
    minimumCount: Math.max(1, minimumCount.value || 1),
    excluded: deletedWords.value,
  }),
);
const visibleCandidates = computed(() =>
  filterGlossaryCandidates(sourceCounts.value, {
    minimumCount: Math.max(1, minimumCount.value || 1),
    excluded: deletedWords.value,
    query: query.value,
    sort: sort.value,
  }),
);
const allVisibleSelected = computed(
  () =>
    visibleCandidates.value.length > 0 &&
    visibleCandidates.value.every(({ word }) =>
      selectedWords.value.includes(word),
    ),
);
const translationPercentage = computed(() =>
  translationProgress.value.total === 0
    ? 0
    : Math.round(
        (translationProgress.value.completed /
          translationProgress.value.total) *
          100,
      ),
);
const lastDeletedHint = computed(() => {
  const words = deletionHistory.value.at(-1);
  if (words === undefined) return '';
  return words.length === 1 ? words[0] : `${words.length} 个词语`;
});

watch(visibleCandidates, (candidates) => {
  const visible = new Set(candidates.map(({ word }) => word));
  selectedWords.value = selectedWords.value.filter((word) => visible.has(word));
});

watch(
  () => gptWorkspace.value.workers,
  (workers) => {
    if (!workers.some(({ id }) => id === selectedGptWorkerId.value)) {
      selectedGptWorkerId.value = workers[0]?.id;
    }
  },
  { deep: true },
);

watch(
  () => sakuraWorkspace.value.workers,
  (workers) => {
    if (!workers.some(({ id }) => id === selectedSakuraWorkerId.value)) {
      selectedSakuraWorkerId.value = workers[0]?.id;
    }
  },
  { deep: true },
);

watch(
  () => props.files,
  async (files) => {
    const request = ++extractionRequest;
    translationController?.abort(
      new DOMException('源文件已变化', 'AbortError'),
    );
    sourceCounts.value = new Map();
    deletedWords.value = new Set();
    deletionHistory.value = [];
    selectedWords.value = [];
    translations.value = {};
    manuallyEdited.value = new Set();
    translationFailures.value = new Map();
    extractionLoading.value = true;
    extractionError.value = '';
    try {
      const counts = await Promise.all(
        files.map(async (file) => {
          const content =
            file.type === 'txt' ? file.text : await file.getText();
          return countKatakanaTerms(content);
        }),
      );
      if (request !== extractionRequest) return;
      sourceCounts.value = mergeGlossaryCounts(counts);
    } catch (error) {
      if (request === extractionRequest) extractionError.value = String(error);
    } finally {
      if (request === extractionRequest) extractionLoading.value = false;
    }
  },
  { immediate: true },
);

const setSelected = (word: string, selected: boolean) => {
  selectedWords.value = selected
    ? [...new Set([...selectedWords.value, word])]
    : selectedWords.value.filter((item) => item !== word);
};

const toggleSelectAll = () => {
  selectedWords.value = allVisibleSelected.value
    ? []
    : visibleCandidates.value.map(({ word }) => word);
};

const removeWords = (words: string[]) => {
  const unique = [...new Set(words)].filter(
    (word) => !deletedWords.value.has(word),
  );
  if (unique.length === 0) return;
  deletedWords.value = new Set([...deletedWords.value, ...unique]);
  deletionHistory.value.push(unique);
  selectedWords.value = selectedWords.value.filter(
    (word) => !unique.includes(word),
  );
};

const undoDelete = () => {
  const words = deletionHistory.value.pop();
  if (words === undefined) return;
  const restored = new Set(deletedWords.value);
  words.forEach((word) => restored.delete(word));
  deletedWords.value = restored;
};

const updateTranslation = (word: string, value: string) => {
  translations.value = { ...translations.value, [word]: value };
  manuallyEdited.value = new Set([...manuallyEdited.value, word]);
  const failures = new Map(translationFailures.value);
  failures.delete(word);
  translationFailures.value = failures;
};

const glossaryText = () =>
  Glossary.toText(
    Object.fromEntries(
      activeCandidates.value.map(({ word }) => [
        word,
        translations.value[word] ?? '',
      ]),
    ),
  );

const copyGlossary = async () => {
  try {
    await navigator.clipboard.writeText(glossaryText());
    message.success('术语表已复制到剪贴板');
  } catch (error) {
    message.error(`复制失败：${error}`);
  }
};

const downloadGlossary = () => {
  downloadFile(
    '工具箱术语表.txt',
    new Blob([glossaryText()], { type: 'text/plain;charset=utf-8' }),
  );
};

const translatorConfig = (
  id: 'baidu' | 'youdao' | 'gpt' | 'sakura',
): TranslatorConfig | undefined => {
  if (id === 'baidu' || id === 'youdao') return { id };
  if (id === 'gpt') {
    const worker = gptWorkspace.value.workers.find(
      ({ id }) => id === selectedGptWorkerId.value,
    );
    if (worker === undefined) return undefined;
    return {
      id,
      model: worker.model,
      endpoint: worker.endpoint,
      key: worker.key,
    };
  }
  const worker = sakuraWorkspace.value.workers.find(
    ({ id }) => id === selectedSakuraWorkerId.value,
  );
  if (worker === undefined) return undefined;
  return {
    id,
    endpoint: worker.endpoint,
    segLength: worker.segLength,
    prevSegLength: worker.prevSegLength,
  };
};

const translateCandidates = async (
  id: 'baidu' | 'youdao' | 'gpt' | 'sakura',
) => {
  if (translating.value) return;
  const config = translatorConfig(id);
  if (config === undefined) {
    message.error(`未选择 ${id === 'gpt' ? 'GPT' : 'Sakura'} 翻译器`);
    return;
  }
  const words = activeCandidates.value
    .map(({ word }) => word)
    .filter((word) => !manuallyEdited.value.has(word));
  if (words.length === 0) {
    message.info('没有可自动翻译的词语；手工编辑不会被覆盖');
    return;
  }

  const controller = new AbortController();
  translationController = controller;
  translating.value = true;
  translationFailures.value = new Map();
  translationProgress.value = {
    total: words.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    currentWord: '',
  };
  try {
    const translator = await Translator.create(config, false);
    if (controller.signal.aborted) throw controller.signal.reason;
    const result = await translateGlossaryWords(
      words,
      (batch, signal) => translator.translate(batch, { signal }),
      {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) translationProgress.value = progress;
        },
      },
    );
    translations.value = mergeAutomaticTranslations(
      translations.value,
      result.translations,
      manuallyEdited.value,
    );
    translationFailures.value = result.failures;
    if (result.failures.size > 0) {
      message.warning(
        `翻译部分完成：成功 ${result.translations.size}，失败 ${result.failures.size}`,
      );
    } else {
      message.success(`已翻译 ${result.translations.size} 个词语`);
    }
  } catch (error) {
    if (controller.signal.aborted) message.info('术语翻译已取消');
    else message.error(`翻译器错误：${error}`);
  } finally {
    if (translationController === controller) translationController = undefined;
    translating.value = false;
  }
};

const cancelTranslation = () =>
  translationController?.abort(new DOMException('用户取消', 'AbortError'));

onBeforeUnmount(() => {
  extractionRequest += 1;
  translationController?.abort(new DOMException('页面已关闭', 'AbortError'));
});
</script>

<template>
  <n-flex vertical size="large">
    <bulletin>
      <n-p>按片假名出现频次提取候选词，再由用户检查、编辑和导出。</n-p>
      <n-p>阈值包含等于该次数的词语；自动翻译不会覆盖任何手工编辑。</n-p>
    </bulletin>

    <div class="glossary-toolbar">
      <div class="glossary-toolbar__row glossary-toolbar__row--primary">
        <c-action-wrapper title="最低次数" class="glossary-toolbar__minimum">
          <n-input-number
            v-model:value="minimumCount"
            class="glossary-toolbar__minimum-input"
            size="small"
            :min="1"
            :precision="0"
          />
        </c-action-wrapper>
        <n-input
          v-model:value="query"
          class="glossary-toolbar__search"
          clearable
          size="small"
          placeholder="搜索候选词"
        />
      </div>
      <div class="glossary-toolbar__row glossary-toolbar__row--secondary">
        <n-select
          v-model:value="sort"
          class="glossary-toolbar__sort"
          size="small"
          :options="sortOptions"
        />
        <n-text depth="3" class="glossary-toolbar__summary">
          <span class="glossary-toolbar__summary--desktop">
            候选 {{ activeCandidates.length }} 个 / 当前显示
            {{ visibleCandidates.length }} 个
          </span>
          <span class="glossary-toolbar__summary--mobile">
            候选 {{ activeCandidates.length }} / 显示
            {{ visibleCandidates.length }}
          </span>
        </n-text>
        <c-button
          label="翻译器配置"
          :type="showTranslatorConfigModal ? 'primary' : 'default'"
          :aria-expanded="showTranslatorConfigModal"
          aria-haspopup="dialog"
          size="small"
          :round="false"
          @action="showTranslatorConfigModal = true"
        />
      </div>
    </div>

    <n-flex align="center">
      <c-button
        :label="allVisibleSelected ? '取消全选' : '全选当前'"
        :disabled="visibleCandidates.length === 0"
        size="small"
        :round="false"
        @action="toggleSelectAll"
      />
      <c-button
        label="移除所选"
        :disabled="selectedWords.length === 0"
        size="small"
        :round="false"
        @action="removeWords(selectedWords)"
      />
      <c-button
        label="撤销删除"
        :disabled="deletionHistory.length === 0"
        size="small"
        :round="false"
        @action="undoDelete"
      />
      <n-text v-if="lastDeletedHint" depth="3">
        最近删除：{{ lastDeletedHint }}
      </n-text>
    </n-flex>

    <n-flex align="center" class="glossary-translator-actions">
      <c-button
        label="百度翻译"
        :disabled="translating || activeCandidates.length === 0"
        size="small"
        :round="false"
        @action="translateCandidates('baidu')"
      />
      <c-button
        label="有道翻译"
        :disabled="translating || activeCandidates.length === 0"
        size="small"
        :round="false"
        @action="translateCandidates('youdao')"
      />
      <c-button
        label="GPT 翻译"
        :disabled="translating || activeCandidates.length === 0"
        size="small"
        :round="false"
        @action="translateCandidates('gpt')"
      />
      <c-button
        label="Sakura 翻译"
        :disabled="translating || activeCandidates.length === 0"
        size="small"
        :round="false"
        @action="translateCandidates('sakura')"
      />
      <c-button
        v-if="translating"
        label="取消翻译"
        size="small"
        :round="false"
        @action="cancelTranslation"
      />
    </n-flex>

    <n-flex align="center">
      <c-button
        label="复制术语表"
        :disabled="
          extractionLoading || translating || activeCandidates.length === 0
        "
        size="small"
        :round="false"
        @action="copyGlossary"
      />
      <c-button
        label="下载术语表"
        :disabled="
          extractionLoading || translating || activeCandidates.length === 0
        "
        size="small"
        :round="false"
        @action="downloadGlossary"
      />
    </n-flex>

    <n-alert v-if="extractionError" type="error">
      提取失败：{{ extractionError }}
    </n-alert>
    <n-spin v-else-if="extractionLoading" show>正在提取候选词…</n-spin>

    <n-flex v-if="translating" vertical size="small">
      <n-text>
        正在翻译 {{ translationProgress.completed }}/{{
          translationProgress.total
        }}
        <template v-if="translationProgress.currentWord">
          · {{ translationProgress.currentWord }}
        </template>
      </n-text>
      <n-progress
        type="line"
        :percentage="translationPercentage"
        :show-indicator="false"
      />
    </n-flex>

    <n-alert
      v-if="translationFailures.size > 0"
      type="warning"
      title="部分词语翻译失败，成功结果和手工编辑已保留"
    >
      {{ [...translationFailures.keys()].join('、') }}
    </n-alert>

    <n-scrollbar
      v-if="visibleCandidates.length > 0"
      trigger="none"
      class="glossary-table"
    >
      <n-table striped size="small">
        <thead>
          <tr>
            <th>选择</th>
            <th>次数</th>
            <th>原词</th>
            <th>译文</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="candidate of visibleCandidates" :key="candidate.word">
            <td>
              <n-checkbox
                :checked="selectedWords.includes(candidate.word)"
                :aria-label="`选择 ${candidate.word}`"
                @update:checked="setSelected(candidate.word, $event)"
              />
            </td>
            <td>{{ candidate.count }}</td>
            <td>{{ candidate.word }}</td>
            <td class="glossary-table__translation">
              <n-input
                :value="translations[candidate.word] ?? ''"
                size="small"
                placeholder="请输入中文翻译"
                @update:value="updateTranslation(candidate.word, $event)"
              />
            </td>
            <td>
              <n-tag
                v-if="manuallyEdited.has(candidate.word)"
                size="small"
                type="info"
              >
                手工
              </n-tag>
              <n-tag
                v-else-if="translationFailures.has(candidate.word)"
                size="small"
                type="error"
              >
                失败
              </n-tag>
              <n-tag
                v-else-if="translations[candidate.word] !== undefined"
                size="small"
                type="success"
              >
                已翻译
              </n-tag>
              <n-text v-else depth="3">未翻译</n-text>
            </td>
            <td>
              <c-icon-button
                tooltip="移除"
                :aria-label="`移除 ${candidate.word}`"
                :icon="DeleteOutlineOutlined"
                text
                size="small"
                type="error"
                @action="removeWords([candidate.word])"
              />
            </td>
          </tr>
        </tbody>
      </n-table>
    </n-scrollbar>

    <n-empty
      v-else-if="!extractionLoading && !extractionError"
      class="glossary-empty-state"
      description="没有符合当前条件的候选词"
    />
  </n-flex>

  <c-modal
    v-model:show="showTranslatorConfigModal"
    title="翻译器配置"
    style="width: min(440px, calc(100vw - 16px))"
  >
    <n-flex align="center" class="glossary-translator-selectors">
      <label class="glossary-translator-selector">
        <n-text depth="3">GPT 翻译器</n-text>
        <n-select
          v-model:value="selectedGptWorkerId"
          :options="gptWorkerOptions"
          :disabled="translating"
          placeholder="未配置 GPT 翻译器"
          aria-label="选择 GPT 翻译器"
          size="small"
        />
      </label>
      <label class="glossary-translator-selector">
        <n-text depth="3">Sakura 翻译器</n-text>
        <n-select
          v-model:value="selectedSakuraWorkerId"
          :options="sakuraWorkerOptions"
          :disabled="translating"
          placeholder="未配置 Sakura 翻译器"
          aria-label="选择 Sakura 翻译器"
          size="small"
        />
      </label>
    </n-flex>
  </c-modal>
</template>

<style scoped>
.glossary-table {
  max-width: 920px;
  max-height: 60vh;
}

.glossary-table__translation {
  min-width: 220px;
}

.glossary-toolbar,
.glossary-toolbar__row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.glossary-toolbar {
  box-sizing: border-box;
  width: 100%;
}

.glossary-toolbar__row--secondary {
  min-width: 0;
  flex: 1;
}

.glossary-toolbar__minimum-input {
  width: 120px;
}

.glossary-toolbar__search {
  width: min(240px, 100%);
}

.glossary-toolbar__sort {
  width: 130px;
}

.glossary-toolbar__summary {
  white-space: nowrap;
}

.glossary-toolbar__summary--mobile {
  display: none;
}

.glossary-toolbar__row--secondary > :last-child {
  margin-left: auto;
}

.glossary-translator-selector {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 6px;
}

.glossary-translator-selectors {
  box-sizing: border-box;
  width: 100%;
}

.glossary-empty-state {
  padding-top: clamp(48px, 8vh, 80px);
}

.glossary-translator-selector :deep(.n-select) {
  width: 100%;
}

@media (max-width: 639px) {
  .glossary-table {
    max-width: calc(100vw - 32px);
  }

  .glossary-table__translation {
    min-width: 180px;
  }

  .glossary-translator-actions,
  .glossary-translator-selectors {
    width: 100%;
  }

  .glossary-translator-selector {
    width: 100%;
  }

  .glossary-toolbar {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .glossary-toolbar__row {
    width: 100%;
    gap: 8px;
  }

  .glossary-toolbar__row--primary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .glossary-toolbar__row--secondary {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr) auto;
  }

  .glossary-toolbar__minimum-input {
    width: 100px;
  }

  .glossary-toolbar__search,
  .glossary-toolbar__sort {
    width: 100%;
  }

  .glossary-toolbar__summary {
    overflow: hidden;
    font-size: 12px;
    text-overflow: clip;
  }

  .glossary-toolbar__summary--desktop {
    display: none;
  }

  .glossary-toolbar__summary--mobile {
    display: inline;
  }

  .glossary-toolbar__row--secondary > :last-child {
    margin-left: 0;
    justify-self: end;
  }
}
</style>
