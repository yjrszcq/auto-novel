<script lang="ts" setup>
import type { SelectOption } from 'naive-ui';
import { ArrowBackOutlined, RestoreOutlined } from '@vicons/material';
import { useMediaQuery } from '@vueuse/core';
import { useRouter } from 'vue-router';

import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import { useLocalVolumeStore } from '@/stores';

import BookCover from './components/BookCover.vue';
import {
  createBookMetadataForm,
  isValidLanguageTag,
  restoreSourceMetadata,
  toBookMetadata,
  type BookMetadataFormValue,
} from './BookMetadataEditor';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const isMobile = useMediaQuery('(max-width: 700px)');
const loading = ref(true);
const saving = ref(false);
const error = ref<string>();
const volume = shallowRef<LocalVolumeMetadata>();
const coverInput = ref<HTMLInputElement>();
const coverMode = ref<'none' | 'link' | 'upload'>('none');
const coverUrlInput = ref('');
const coverPreviewUrl = ref<string | null>(null);
const coverMutation = shallowRef<
  | { bookId: string; blob: Blob; source: 'custom'; updatedAt: number }
  | null
  | undefined
>();
let storedCustomCover: Blob | undefined;
let coverObjectUrl: string | undefined;
const form = reactive<BookMetadataFormValue>({
  title: '',
  authors: [],
  description: '',
  coverUrl: '',
  languages: [],
  originalDownload: 'global',
  translatedDownload: 'global',
});
const repositoryPromise = useLocalVolumeStore();
const bookId = computed(() => String(route.params.bookId));
const isEpub = computed(() => volume.value?.sourceFormat === 'epub');

const languageOptions: SelectOption[] = [
  { label: '中文（简体）', value: 'zh-CN' },
  { label: '中文（繁体）', value: 'zh-TW' },
  { label: '日语', value: 'ja' },
  { label: '英语', value: 'en' },
  { label: '韩语', value: 'ko' },
];
const downloadPolicyOptions = [
  { label: '跟随全局设置', value: 'global' },
  { label: '开启', value: 'embed' },
  { label: '关闭', value: 'source' },
];

const assignForm = (value: BookMetadataFormValue) => Object.assign(form, value);

const clearCoverObjectUrl = () => {
  if (coverObjectUrl !== undefined) URL.revokeObjectURL(coverObjectUrl);
  coverObjectUrl = undefined;
};

const previewUploadedCover = (blob: Blob) => {
  clearCoverObjectUrl();
  coverObjectUrl = URL.createObjectURL(blob);
  coverPreviewUrl.value = coverObjectUrl;
};

const useUploadedCover = (blob: Blob, persist: boolean) => {
  coverMode.value = 'upload';
  coverUrlInput.value = '';
  form.coverUrl = '';
  previewUploadedCover(blob);
  coverMutation.value = persist
    ? {
        bookId: bookId.value,
        blob,
        source: 'custom',
        updatedAt: Date.now(),
      }
    : undefined;
};

const useSourceCover = (deleteStoredCustom: boolean) => {
  clearCoverObjectUrl();
  coverMode.value = 'none';
  coverUrlInput.value = '';
  form.coverUrl = '';
  coverPreviewUrl.value = null;
  coverMutation.value = deleteStoredCustom ? null : undefined;
};

const load = async () => {
  loading.value = true;
  error.value = undefined;
  try {
    const repository = await repositoryPromise;
    const [loadedVolume, cover] = await Promise.all([
      repository.getVolume(bookId.value),
      repository.getReaderCover(bookId.value),
    ]);
    if (loadedVolume === undefined) throw new Error('书籍不存在');
    volume.value = loadedVolume;
    const initialForm = createBookMetadataForm(loadedVolume);
    assignForm(initialForm);
    storedCustomCover = cover?.source === 'custom' ? cover.blob : undefined;
    coverUrlInput.value = initialForm.coverUrl.trim();
    if (coverUrlInput.value.length > 0) {
      coverMode.value = 'link';
      coverPreviewUrl.value = coverUrlInput.value;
      coverMutation.value = storedCustomCover === undefined ? undefined : null;
    } else if (storedCustomCover !== undefined) {
      useUploadedCover(storedCustomCover, false);
    } else {
      useSourceCover(false);
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法加载书籍信息';
  } finally {
    loading.value = false;
  }
};

const returnToDetails = () =>
  void router.push('/books/' + encodeURIComponent(bookId.value) + '/details');

const restore = () => {
  if (volume.value === undefined) return;
  assignForm(restoreSourceMetadata(form, volume.value));
  useSourceCover(storedCustomCover !== undefined);
  message.info('已恢复原文件元信息，提交后生效');
};

const updateCoverUrlInput = (value: string) => {
  coverUrlInput.value = value;
  if (coverMode.value === 'link' && value.trim().length === 0) {
    useSourceCover(storedCustomCover !== undefined);
  }
};

const applyCoverUrl = () => {
  const value = coverUrlInput.value.trim();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    message.warning('请输入有效的 HTTP 或 HTTPS 图片链接');
    return;
  }
  clearCoverObjectUrl();
  coverMode.value = 'link';
  coverUrlInput.value = value;
  form.coverUrl = value;
  coverPreviewUrl.value = value;
  coverMutation.value = storedCustomCover === undefined ? undefined : null;
};

const selectCover = () => coverInput.value?.click();

const uploadCover = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined) return;
  if (!file.type.startsWith('image/')) {
    message.warning('请选择图片文件');
    return;
  }
  useUploadedCover(file, true);
};

const removeCover = () => useSourceCover(storedCustomCover !== undefined);

const coverActionLabel = computed(() => {
  if (coverMode.value === 'upload') return '移除';
  if (
    coverMode.value === 'link' &&
    coverUrlInput.value.trim() === form.coverUrl.trim()
  ) {
    return '移除';
  }
  return coverUrlInput.value.trim().length > 0 ? '应用' : '上传';
});

const handleCoverAction = () => {
  if (coverActionLabel.value === '移除') removeCover();
  else if (coverActionLabel.value === '应用') applyCoverUrl();
  else selectCover();
};

const createLanguage = (label: string) => {
  const value = label.trim();
  if (!isValidLanguageTag(value)) {
    message.warning('请输入合法的 BCP 47 语言标签');
    return false;
  }
  return { label: value, value };
};

const submit = async () => {
  if (volume.value === undefined) return;
  if (form.languages.some((language) => !isValidLanguageTag(language))) {
    message.warning('语言列表中包含无效标签');
    return;
  }
  if (
    coverMode.value !== 'upload' &&
    coverUrlInput.value.trim() !== form.coverUrl.trim()
  ) {
    message.warning('请先应用封面链接');
    return;
  }
  saving.value = true;
  try {
    const repository = await repositoryPromise;
    await repository.updateBookPresentation(bookId.value, {
      bookMetadata: toBookMetadata(form),
      downloadMetadataPreference: isEpub.value
        ? {
            original: form.originalDownload,
            translated: form.translatedDownload,
          }
        : undefined,
      cover: coverMutation.value,
    });
    message.success('书籍信息已保存');
    returnToDetails();
  } catch (reason) {
    message.error('保存失败：' + String(reason));
  } finally {
    saving.value = false;
  }
};

onMounted(() => void load());
onBeforeUnmount(clearCoverObjectUrl);
</script>

<template>
  <main class="metadata-edit layout-content">
    <div v-if="loading" class="metadata-edit__status">
      <n-spin size="large" />
    </div>
    <n-alert v-else-if="error" title="无法加载书籍" type="error">
      {{ error }}
    </n-alert>
    <template v-else-if="volume">
      <header class="metadata-edit__header">
        <n-button
          class="metadata-edit__back"
          circle
          quaternary
          aria-label="返回书籍详情"
          @click="returnToDetails"
        >
          <template #icon><n-icon :component="ArrowBackOutlined" /></template>
        </n-button>
        <div class="metadata-edit__heading">
          <n-h1>编辑书籍展示信息</n-h1>
        </div>
      </header>

      <n-card class="metadata-edit__card" :bordered="true">
        <div class="metadata-edit__layout">
          <aside class="metadata-edit__cover">
            <BookCover
              :book-id="bookId"
              :preview-url="coverPreviewUrl"
              :title="form.title || bookId"
              visual-only
            />
          </aside>
          <n-form
            class="metadata-edit__form"
            :label-placement="isMobile ? 'top' : 'left'"
            :label-width="isMobile ? 'auto' : 72"
          >
            <n-form-item label="书名">
              <n-input
                v-model:value="form.title"
                maxlength="200"
                show-count
                placeholder="原文件未提供书名"
              />
            </n-form-item>
            <n-form-item label="作者">
              <n-dynamic-tags v-model:value="form.authors" />
            </n-form-item>
            <n-form-item label="简介">
              <n-input
                v-model:value="form.description"
                type="textarea"
                :autosize="{ minRows: 5, maxRows: 14 }"
                maxlength="5000"
                show-count
                placeholder="原文件未提供简介"
              />
            </n-form-item>
            <n-form-item label="封面">
              <div class="metadata-edit__cover-field">
                <n-input
                  :disabled="coverMode === 'upload'"
                  :placeholder="
                    coverMode === 'upload'
                      ? '已使用上传封面'
                      : 'https://example.com/cover.jpg'
                  "
                  :value="coverUrlInput"
                  clearable
                  @update:value="updateCoverUrlInput"
                />
                <n-button
                  class="metadata-edit__cover-action"
                  @click="handleCoverAction"
                >
                  {{ coverActionLabel }}
                </n-button>
                <input
                  ref="coverInput"
                  accept="image/*"
                  hidden
                  type="file"
                  @change="uploadCover"
                />
              </div>
            </n-form-item>
            <n-form-item label="语言">
              <n-select
                v-model:value="form.languages"
                multiple
                filterable
                tag
                :options="languageOptions"
                :on-create="createLanguage"
                placeholder="原文件未提供语言"
              />
            </n-form-item>

            <template v-if="isEpub">
              <n-divider>下载时展示信息嵌入元数据</n-divider>
              <n-form-item label="原文">
                <n-select
                  v-model:value="form.originalDownload"
                  :options="downloadPolicyOptions"
                />
              </n-form-item>
              <n-form-item label="译文">
                <n-select
                  v-model:value="form.translatedDownload"
                  :options="downloadPolicyOptions"
                />
              </n-form-item>
            </template>
          </n-form>
        </div>
        <template #footer>
          <n-flex justify="space-between">
            <n-button v-if="isEpub" @click="restore">
              <template #icon><n-icon :component="RestoreOutlined" /></template>
              还原原始元信息
            </n-button>
            <span v-else />
            <n-flex>
              <n-button @click="returnToDetails">取消</n-button>
              <n-button type="primary" :loading="saving" @click="submit">
                提交
              </n-button>
            </n-flex>
          </n-flex>
        </template>
      </n-card>
    </template>
  </main>
</template>

<style scoped>
.metadata-edit {
  box-sizing: border-box;
  width: min(1040px, 100%);
  padding-block: 40px 64px;
}

.metadata-edit__status {
  display: grid;
  min-height: 240px;
  place-items: center;
}

.metadata-edit__header {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  margin-bottom: 24px;
}

.metadata-edit__back {
  width: 40px;
  height: 40px;
}

.metadata-edit__back :deep(.n-button__icon) {
  font-size: 30px;
}

.metadata-edit__heading {
  min-width: 0;
}

.metadata-edit__header :deep(.n-h1) {
  display: flex;
  align-items: center;
  min-height: 40px;
  margin: 0 0 4px;
  line-height: 1.15;
}

.metadata-edit__layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 36px;
}

.metadata-edit__cover :deep(.book-cover) {
  width: 100%;
}

.metadata-edit__cover-field {
  display: flex;
  width: 100%;
  gap: 8px;
}

.metadata-edit__cover-action {
  flex: none;
}

@media (max-width: 700px) {
  .metadata-edit {
    padding: 24px 12px 48px;
  }

  .metadata-edit__layout {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .metadata-edit__cover {
    width: min(180px, 48vw);
    margin-inline: auto;
  }

  .metadata-edit__form :deep(.n-form-item-label) {
    justify-content: flex-start;
    height: auto;
    padding-bottom: 6px;
  }
}
</style>
