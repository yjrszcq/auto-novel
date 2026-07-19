<script lang="ts" setup>
import type { Epub, ParsedFile } from '@/util/file';
import { StandardNovel } from '@/util/file';
import { Toolbox } from './Toolbox';
import { useToolboxOperation } from './ToolboxOperation';

const props = defineProps<{
  files: ParsedFile[];
}>();

const operation = useToolboxOperation();

const convertEpubToTxt = async (epub: Epub) => {
  const novel = StandardNovel.fromEpub(epub);
  return await StandardNovel.toTxt(novel);
};

const convertAll = () => {
  const files = props.files.filter((file) => file.type === 'epub');
  return operation.run('EPUB 转 TXT', files.length, (options) =>
    Toolbox.convertFiles(files, convertEpubToTxt, options),
  );
};
</script>

<template>
  <n-flex vertical>
    <n-flex>
      <c-button
        label="转换"
        :disabled="operation.state.busy"
        size="small"
        @action="convertAll"
      />
    </n-flex>
  </n-flex>
</template>
