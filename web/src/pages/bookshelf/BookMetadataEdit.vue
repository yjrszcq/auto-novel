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
const hasCustomCover = ref(false);
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
    hasCustomCover.value = cover?.source === 'custom';
    assignForm(createBookMetadataForm(loadedVolume));
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
  message.info('已恢复原文件元信息，提交后生效');
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
          <n-h1>编辑书籍信息</n-h1>
          <n-text depth="3">
            修改仅保存在当前浏览器，原始文件不会被覆盖。
          </n-text>
        </div>
      </header>

      <n-card class="metadata-edit__card" :bordered="true">
        <div class="metadata-edit__layout">
          <aside class="metadata-edit__cover">
            <BookCover
              :book-id="bookId"
              :title="form.title || bookId"
              visual-only
            />
          </aside>
          <n-form
            class="metadata-edit__form"
            :label-placement="isMobile ? 'top' : 'left'"
            :label-width="isMobile ? 'auto' : 96"
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
            <n-form-item label="封面链接">
              <div class="metadata-edit__field-stack">
                <n-input
                  v-model:value="form.coverUrl"
                  clearable
                  placeholder="https://example.com/cover.jpg"
                />
                <n-alert v-if="hasCustomCover" type="warning">
                  已设置本地自定义封面。封面链接为空时继续使用该封面。
                </n-alert>
                <n-text v-if="form.coverUrl.trim()" depth="3">
                  封面链接会优先用于页面展示；启用下载嵌入时也优先嵌入该链接图片。
                </n-text>
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
              <n-divider>下载副本</n-divider>
              <n-form-item label="原文下载">
                <n-select
                  v-model:value="form.originalDownload"
                  :options="downloadPolicyOptions"
                />
              </n-form-item>
              <n-form-item label="译文下载">
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

.metadata-edit__field-stack {
  display: grid;
  width: 100%;
  gap: 10px;
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
