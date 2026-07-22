<script lang="ts" setup>
import { InfoOutlined } from '@vicons/material';
import { useMediaQuery } from '@vueuse/core';

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
const isMobile = useMediaQuery('(max-width: 639px)');
const showLanguageDetectionHelp = ref(false);
const showDownloadMetadataHelp = ref(false);
const showReaderPreloadHelp = ref(false);
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
            <div class="number-setting-control">
              <n-input-number
                v-model:value="languageDetectionConfidencePercent"
                class="number-setting-input language-detection-setting__input"
                :min="0"
                :max="100"
                :precision="0"
                :input-props="{ 'aria-label': '语言检测置信度阈值' }"
              >
                <template #suffix>%</template>
              </n-input-number>
              <n-popover
                v-if="!isMobile"
                trigger="click"
                placement="bottom-start"
                :style="{
                  maxWidth: 'min(360px, calc(100vw - 32px))',
                  whiteSpace: 'normal',
                }"
              >
                <template #trigger>
                  <n-button
                    class="setting-info-button"
                    quaternary
                    circle
                    size="small"
                    aria-label="语言检测阈值说明"
                  >
                    <template #icon>
                      <n-icon :component="InfoOutlined" />
                    </template>
                  </n-button>
                </template>
                仅采用高于阈值的正文检测结果；检测语言与文件元数据没有重合时以检测结果为准，否则补充缺失语言。
              </n-popover>
              <n-button
                v-else
                class="setting-info-button"
                quaternary
                circle
                size="small"
                aria-label="语言检测阈值说明"
                @click="showLanguageDetectionHelp = true"
              >
                <template #icon>
                  <n-icon :component="InfoOutlined" />
                </template>
              </n-button>
            </div>
          </c-action-wrapper>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical :size="8">
          <b>翻译 API</b>
          <c-action-wrapper
            title="百度翻译"
            align="center"
            class="translation-api-setting"
          >
            <div class="translation-api-setting__fields">
              <n-input
                v-model:value="setting.translationApi.baidu.appId"
                placeholder="App ID"
                :input-props="{ 'aria-label': '百度翻译 App ID' }"
              />
              <n-input
                v-model:value="setting.translationApi.baidu.secretKey"
                type="password"
                show-password-on="click"
                placeholder="密钥"
                :input-props="{ 'aria-label': '百度翻译密钥' }"
              />
            </div>
          </c-action-wrapper>
          <c-action-wrapper
            title="有道翻译"
            align="center"
            class="translation-api-setting"
          >
            <div class="translation-api-setting__fields">
              <n-input
                v-model:value="setting.translationApi.youdao.appKey"
                placeholder="应用 ID"
                :input-props="{ 'aria-label': '有道翻译应用 ID' }"
              />
              <n-input
                v-model:value="setting.translationApi.youdao.appSecret"
                type="password"
                show-password-on="click"
                placeholder="应用密钥"
                :input-props="{ 'aria-label': '有道翻译应用密钥' }"
              />
            </div>
          </c-action-wrapper>
        </n-flex>
      </n-list-item>

      <n-list-item>
        <n-flex vertical :size="8">
          <b>下载</b>
          <c-action-wrapper
            title="下载语言"
            align="center"
            class="download-setting-row"
          >
            <c-radio-group
              v-model:value="setting.homeDownloadMode"
              :options="Setting.downloadModeOptions"
              size="small"
            />
          </c-action-wrapper>
          <c-action-wrapper
            title="优先下载"
            align="center"
            class="download-setting-row"
          >
            <c-radio-group
              v-model:value="setting.homeDownloadPriority"
              :options="Setting.homeDownloadPriorityOptions"
              size="small"
            />
          </c-action-wrapper>
          <c-action-wrapper
            title="展示信息嵌入"
            align="center"
            class="download-setting-row"
          >
            <div class="download-metadata-setting">
              <n-button-group size="small">
                <n-button
                  :type="
                    setting.embedMetadataInOriginalDownload
                      ? 'primary'
                      : 'default'
                  "
                  :aria-pressed="setting.embedMetadataInOriginalDownload"
                  @click="
                    setting.embedMetadataInOriginalDownload =
                      !setting.embedMetadataInOriginalDownload
                  "
                >
                  原文
                </n-button>
                <n-button
                  :type="
                    setting.embedMetadataInTranslatedDownload
                      ? 'primary'
                      : 'default'
                  "
                  :aria-pressed="setting.embedMetadataInTranslatedDownload"
                  @click="
                    setting.embedMetadataInTranslatedDownload =
                      !setting.embedMetadataInTranslatedDownload
                  "
                >
                  译文
                </n-button>
              </n-button-group>
              <n-popover
                v-if="!isMobile"
                trigger="click"
                placement="top-start"
                :style="{
                  maxWidth: 'min(360px, calc(100vw - 32px))',
                  whiteSpace: 'normal',
                }"
              >
                <template #trigger>
                  <n-button
                    class="setting-info-button"
                    quaternary
                    circle
                    size="small"
                    aria-label="展示信息嵌入说明"
                  >
                    <template #icon>
                      <n-icon :component="InfoOutlined" />
                    </template>
                  </n-button>
                </template>
                仅修改下载副本，浏览器中保存的原始 EPUB 不会改变。
              </n-popover>
              <n-button
                v-else
                class="setting-info-button"
                quaternary
                circle
                size="small"
                aria-label="展示信息嵌入说明"
                @click="showDownloadMetadataHelp = true"
              >
                <template #icon>
                  <n-icon :component="InfoOutlined" />
                </template>
              </n-button>
            </div>
          </c-action-wrapper>
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
            <div class="number-setting-control">
              <n-input-number
                class="number-setting-input reader-preload-setting__input"
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
              <n-popover
                v-if="!isMobile"
                trigger="click"
                placement="bottom-start"
                :style="{
                  maxWidth: 'min(320px, calc(100vw - 32px))',
                  whiteSpace: 'normal',
                }"
              >
                <template #trigger>
                  <n-button
                    class="setting-info-button"
                    quaternary
                    circle
                    size="small"
                    aria-label="自动翻译预翻译说明"
                  >
                    <template #icon>
                      <n-icon :component="InfoOutlined" />
                    </template>
                  </n-button>
                </template>
                提前翻译当前页之后的页数；0 表示只处理当前可见页。
              </n-popover>
              <n-button
                v-else
                class="setting-info-button"
                quaternary
                circle
                size="small"
                aria-label="自动翻译预翻译说明"
                @click="showReaderPreloadHelp = true"
              >
                <template #icon>
                  <n-icon :component="InfoOutlined" />
                </template>
              </n-button>
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

    <c-modal
      v-model:show="showLanguageDetectionHelp"
      title="语言检测阈值"
      aria-label="语言检测阈值"
    >
      仅采用高于阈值的正文检测结果；检测语言与文件元数据没有重合时以检测结果为准，否则补充缺失语言。
    </c-modal>
    <c-modal
      v-model:show="showReaderPreloadHelp"
      title="自动翻译预翻译"
      aria-label="自动翻译预翻译"
    >
      提前翻译当前页之后的页数；0 表示只处理当前可见页。
    </c-modal>
    <c-modal
      v-model:show="showDownloadMetadataHelp"
      title="展示信息嵌入"
      aria-label="展示信息嵌入"
    >
      仅修改下载副本，浏览器中保存的原始 EPUB 不会改变。
    </c-modal>
  </div>
</template>

<style scoped>
.reader-setting-row {
  display: grid !important;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}

.download-setting-row {
  display: grid !important;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}

.download-metadata-setting {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.language-detection-setting {
  display: grid !important;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}

.number-setting-control {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.number-setting-input {
  width: 240px;
  flex: 0 0 auto;
}

.setting-info-button {
  flex: 0 0 auto;
}

.translation-api-setting {
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}

.translation-api-setting__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 320px));
  gap: 12px;
}

@media (max-width: 700px) {
  .language-detection-setting,
  .reader-setting-row,
  .translation-api-setting {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .number-setting-control {
    width: 100%;
  }

  .number-setting-input {
    width: auto;
    min-width: 0;
    flex: 1 1 auto;
  }

  .translation-api-setting__fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
