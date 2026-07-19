<script lang="ts" setup>
import { PlusOutlined } from '@vicons/material';
import { useMediaQuery } from '@vueuse/core';
import type { UploadCustomRequestOptions, UploadFileInfo } from 'naive-ui';

import { useLocalVolumeManager } from '../LocalVolumeManager';

const props = withDefaults(
  defineProps<{
    favoredId?: string;
    compactOnMobile?: boolean;
    enableDropZone?: boolean;
    round?: boolean;
  }>(),
  {
    favoredId: undefined,
    compactOnMobile: false,
    enableDropZone: true,
    round: true,
  },
);
const emit = defineEmits<{
  done: [File];
}>();

const message = useMessage();
const store = useLocalVolumeManager();
const isMobile = useMediaQuery('(max-width: 639px)');

const handleFinish = ({ file }: { file: UploadFileInfo }) => {
  if (file.file) {
    emit('done', file.file);
  }
};

const beforeUpload = ({ file }: { file: UploadFileInfo }) => {
  const filename = file.name.toLowerCase();
  if (
    !filename.endsWith('.txt') &&
    !filename.endsWith('.epub') &&
    !filename.endsWith('.srt')
  ) {
    message.error(`上传失败: 文件类型不允许\n文件名：${file.name}`);
    return false;
  }
  const size = file.file?.size ?? 0;
  if (size > 100 * 1024 * 1024) {
    message.error(`上传失败: 文件大小不能超过100MB\n文件名：${file.name}`);
    return false;
  }
};

const customRequest = ({
  file,
  onFinish,
  onError,
}: UploadCustomRequestOptions) => {
  store
    .addVolume(file.file!, props.favoredId ?? 'default')
    .then((result) => {
      if (result.diagnostics.length > 0) {
        const visibleDiagnostics = result.diagnostics
          .slice(0, 3)
          .map((diagnostic) => `• ${diagnostic.message}`)
          .join('\n');
        const remaining = result.diagnostics.length - 3;
        message.warning(
          `书籍已导入，并应用 ${result.diagnostics.length} 项兼容处理\n${visibleDiagnostics}${remaining > 0 ? `\n• 另有 ${remaining} 项` : ''}`,
          { duration: 8000, keepAliveOnHover: true },
        );
      }
      onFinish();
    })
    .catch((error) => {
      message.error(`上传失败: ${error}\n文件名：${file.name}`);
      onError();
    });
};
</script>

<template>
  <n-upload
    :show-file-list="false"
    accept=".txt,.epub,.srt"
    multiple
    directory-dnd
    :custom-request="customRequest"
    @before-upload="beforeUpload"
    @finish="handleFinish"
  >
    <n-tooltip trigger="hover" :disabled="isMobile">
      <template #trigger>
        <c-button
          label="添加"
          :icon="PlusOutlined"
          :compact-on-mobile="props.compactOnMobile"
          :round="props.round"
        />
      </template>
      支持拖拽上传 EPUB/TXT/SRT 文件
    </n-tooltip>
  </n-upload>
  <DropZone
    v-if="props.enableDropZone"
    @finish="handleFinish"
    accept=".txt,.epub,.srt"
    multiple
    directory-dnd
    :custom-request="customRequest"
    @before-upload="beforeUpload"
  >
    拖拽文件到这里上传
  </DropZone>
</template>
