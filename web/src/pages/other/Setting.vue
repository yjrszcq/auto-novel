<script lang="ts" setup>
import type {
  ReaderChineseScript,
  ReaderMode,
  ReaderRetranslationPolicy,
  ReaderSettingsRecord,
} from '@/model/Reader';
import { readerModeLabels } from '../reader/core/ReaderMode';
import {
  defaultReaderSettings,
  normalizeReaderAutoTranslationPreloadPages,
  normalizeReaderSettings,
  serializeReaderSettings,
} from '../reader/core/ReaderSettings';
import SoundAllTaskCompleted from '@/sound/all_task_completed.mp3';

import { Setting, useLocalVolumeStore, useSettingStore } from '@/stores';

const settingStore = useSettingStore();
const { setting } = storeToRefs(settingStore);
const message = useMessage();
const readerSettings = ref<ReaderSettingsRecord>({ ...defaultReaderSettings });
const readerSettingsLoading = ref(true);
const readerSettingsSaving = ref(false);
const readerRepositoryPromise = useLocalVolumeStore();
const languageDetectionConfidencePercent = computed<number | null>({
  get: () =>
    Setting.normalizeLanguageDetectionConfidencePercent(
      setting.value.languageDetectionConfidencePercent,
    ),
  set: (value) => {
    setting.value.languageDetectionConfidencePercent =
      Setting.normalizeLanguageDetectionConfidencePercent(value);
  },
});

const readerModeOptions: { label: string; value: ReaderMode }[] = [
  { label: '中文', value: 'translated' },
  { label: '中日', value: 'translated-original' },
  { label: '日中', value: 'original-translated' },
  { label: '原文', value: 'original' },
];
const readerRetranslationPolicyOptions: {
  label: string;
  value: ReaderRetranslationPolicy;
}[] = [
  { label: '询问', value: 'ask' },
  { label: '替换', value: 'replace' },
  { label: '不替换', value: 'keep' },
];
const readerChineseScriptOptions: {
  label: string;
  value: ReaderChineseScript;
}[] = [
  { label: '原文', value: 'none' },
  { label: '简体中文', value: 'simplified' },
  { label: '繁體中文', value: 'traditional' },
];
const playSound = (source: string) => {
  return new Audio(source).play();
};

const loadReaderSettings = async () => {
  readerSettingsLoading.value = true;
  try {
    const repository = await readerRepositoryPromise;
    readerSettings.value = normalizeReaderSettings(
      await repository.getReaderSettings(),
    );
  } catch {
    message.warning('无法读取阅读偏好，已使用默认值');
  } finally {
    readerSettingsLoading.value = false;
  }
};

const isReaderMode = (value: string | number): value is ReaderMode =>
  typeof value === 'string' && value in readerModeLabels;

const persistReaderSettings = async (
  update: (current: ReaderSettingsRecord) => ReaderSettingsRecord,
) => {
  if (readerSettingsLoading.value || readerSettingsSaving.value) return;
  const previous = readerSettings.value;
  const next = { ...update(previous), updatedAt: Date.now() };
  readerSettings.value = next;
  readerSettingsSaving.value = true;
  try {
    const repository = await readerRepositoryPromise;
    await repository.putReaderSettings(serializeReaderSettings(next));
  } catch {
    readerSettings.value = previous;
    message.error('无法保存阅读偏好');
  } finally {
    readerSettingsSaving.value = false;
  }
};

const updateDefaultReaderMode = (value: string | number) => {
  if (!isReaderMode(value)) return;
  void persistReaderSettings((current) => ({
    ...current,
    defaultMode: value,
  }));
};

const updateAutoTranslationPreloadPages = (value: number | null) => {
  void persistReaderSettings((current) => ({
    ...current,
    autoTranslationPreloadPages:
      normalizeReaderAutoTranslationPreloadPages(value),
  }));
};

const updateRetranslationPolicy = (value: string | number) => {
  if (value !== 'ask' && value !== 'replace' && value !== 'keep') return;
  void persistReaderSettings((current) => ({
    ...current,
    retranslationPolicy: value,
  }));
};

const updateReaderChineseScript = (value: string | number) => {
  if (value !== 'none' && value !== 'simplified' && value !== 'traditional') {
    return;
  }
  void persistReaderSettings((current) => ({
    ...current,
    chineseScript: value,
  }));
};

onMounted(() => {
  void loadReaderSettings();
});
</script>

<template>
  <div class="layout-content">
    <n-h1>设置</n-h1>

    <n-list bordered>
      <n-list-item>
        <n-flex vertical>
          <b>主题</b>
          <c-radio-group
            v-model:value="setting.theme"
            :options="Setting.themeOptions"
            size="small"
          />
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>快捷键说明</b>
          <n-ul>
            <n-li>阅读页面，可以使用左右方向键跳转上/下一章。</n-li>
            <n-li>
              阅读页面，可以使用数字键 1～4
              快速切换翻译（中文/中日/日中/原文）。
            </n-li>
            <n-li>
              GPT/Sakura 排队按钮，按住 Ctrl 键点击，会将任务自动置顶。
            </n-li>
          </n-ul>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>首页</b>
          <c-action-wrapper title="下载语言">
            <c-radio-group
              v-model:value="setting.homeDownloadMode"
              :options="Setting.downloadModeOptions"
              size="small"
            />
          </c-action-wrapper>
          <c-action-wrapper title="优先下载">
            <c-radio-group
              v-model:value="setting.homeDownloadPriority"
              :options="Setting.homeDownloadPriorityOptions"
              size="small"
            />
          </c-action-wrapper>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>工作区</b>
          <n-checkbox v-model:checked="setting.autoTopJobWhenAddTask">
            工作区添加时自动置顶
          </n-checkbox>
          <n-flex :wrap="false" :size="0">
            <n-checkbox v-model:checked="setting.workspaceSound">
              任务全部完成时语音提醒
            </n-checkbox>

            [
            <c-button
              label="点击播放"
              text
              type="primary"
              @action="playSound(SoundAllTaskCompleted)"
            />
            ]
          </n-flex>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical :size="8">
          <b>书籍导入</b>
          <c-action-wrapper
            title="语言检测阈值"
            align="center"
            class="language-detection-setting"
          >
            <div class="language-detection-setting__content">
              <n-input-number
                v-model:value="languageDetectionConfidencePercent"
                class="language-detection-setting__input"
                :min="0"
                :max="100"
                :precision="0"
                :input-props="{ 'aria-label': '语言检测置信度阈值' }"
              >
                <template #suffix>%</template>
              </n-input-number>
              <n-text depth="3" class="language-detection-setting__help">
                仅采用高于阈值的正文检测结果；检测语言与文件元数据没有重合时以检测结果为准，否则补充缺失语言。
              </n-text>
            </div>
          </c-action-wrapper>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical>
          <b>本地 EPUB 下载</b>
          <n-checkbox v-model:checked="setting.embedMetadataInOriginalDownload">
            原文下载时展示信息嵌入元数据
          </n-checkbox>
          <n-checkbox
            v-model:checked="setting.embedMetadataInTranslatedDownload"
          >
            译文下载时展示信息嵌入元数据
          </n-checkbox>
          <n-text depth="3">
            仅修改下载副本，浏览器中保存的原始 EPUB 不会改变。
          </n-text>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical :size="8">
          <b>阅读</b>
          <c-action-wrapper
            title="阅读偏好"
            align="center"
            class="reader-setting-row"
          >
            <c-radio-group
              id="reader-default-mode"
              size="small"
              :aria-busy="readerSettingsLoading"
              :value="readerSettings.defaultMode"
              :options="readerModeOptions"
              @update:value="updateDefaultReaderMode"
            />
          </c-action-wrapper>
          <c-action-wrapper
            title="中文字形"
            align="center"
            class="reader-setting-row"
          >
            <c-radio-group
              id="reader-chinese-script"
              size="small"
              :aria-busy="readerSettingsLoading"
              :value="readerSettings.chineseScript"
              :options="readerChineseScriptOptions"
              :disabled="readerSettingsLoading || readerSettingsSaving"
              @update:value="updateReaderChineseScript"
            />
          </c-action-wrapper>
          <c-action-wrapper
            title="自动翻译预翻译"
            align="center"
            class="reader-setting-row reader-preload-setting"
          >
            <div class="reader-preload-setting__content">
              <n-input-number
                class="reader-preload-setting__input"
                :value="readerSettings.autoTranslationPreloadPages"
                :min="0"
                :max="20"
                :precision="0"
                :input-props="{
                  'aria-label': '自动翻译预翻译页数',
                }"
                :disabled="readerSettingsLoading || readerSettingsSaving"
                @update:value="updateAutoTranslationPreloadPages"
              />
              <n-text depth="3" class="reader-preload-setting__help">
                提前翻译当前页之后的页数；0 表示只处理当前可见页。
              </n-text>
            </div>
          </c-action-wrapper>
          <c-action-wrapper
            title="重翻完成后"
            align="center"
            class="reader-setting-row"
          >
            <c-radio-group
              id="reader-retranslation-policy"
              size="small"
              :aria-busy="readerSettingsLoading"
              :value="readerSettings.retranslationPolicy"
              :options="readerRetranslationPolicyOptions"
              :disabled="readerSettingsLoading || readerSettingsSaving"
              @update:value="updateRetranslationPolicy"
            />
          </c-action-wrapper>
        </n-flex>
      </n-list-item>
    </n-list>
  </div>
</template>

<style scoped>
.reader-setting-row {
  display: grid !important;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}

.language-detection-setting {
  display: grid !important;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}

.language-detection-setting__content {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.language-detection-setting__input {
  width: 160px;
  flex: 0 0 auto;
}

.language-detection-setting__help {
  white-space: nowrap;
}

.reader-preload-setting__content {
  display: grid;
  grid-template-columns: minmax(160px, 240px) minmax(240px, 1fr);
  align-items: center;
  gap: 12px;
}

.reader-preload-setting__input {
  width: 100%;
}

.reader-preload-setting__help {
  line-height: 1.5;
}

@media (max-width: 700px) {
  .language-detection-setting,
  .reader-setting-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .language-detection-setting__content {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }

  .language-detection-setting__input {
    width: 100%;
  }

  .language-detection-setting__help {
    white-space: normal;
  }

  .reader-preload-setting__content {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
}
</style>
