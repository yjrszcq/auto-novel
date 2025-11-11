<script lang="ts" setup>
import { PlusOutlined } from '@vicons/material';
import type { UploadCustomRequestOptions, UploadFileInfo } from 'naive-ui';

import { useLocalVolumeManager } from '../LocalVolumeManager';

const props = defineProps<{
  favoredId?: string;
}>();
const emit = defineEmits<{
  done: [File];
}>();

const message = useMessage();
const store = useLocalVolumeManager();

const handleFinish = ({ file }: { file: UploadFileInfo }) => {
  if (file.file) {
    emit('done', file.file);
  }
};

const beforeUpload = ({ file }: { file: UploadFileInfo }) => {
  const filename = file.name.toLowerCase();
  if (!filename.endsWith('.txt') && !filename.endsWith('.epub') && !filename.endsWith('.srt')) {
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
    .then(onFinish)
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
    <n-tooltip trigger="hover">
      <template #trigger>
        <c-button label="添加" :icon="PlusOutlined" />
      </template>
      支持拖拽上传 EPUB/TXT/SRT 文件
    </n-tooltip>
  </n-upload>
  <DropZone
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
