<script lang="ts" setup>
import { ImgComparisonSlider } from '@img-comparison-slider/vue';

import { Humanize } from '@/util';
import type { Epub, ParsedFile } from '@/util/file';

import { Toolbox } from './Toolbox';
import {
  encodeImageBatch,
  resolveImageOutputType,
  throwIfImageProcessingAborted,
  type ImageEncodeOptions,
} from './ToolboxImage';
import { useToolboxOperation } from './ToolboxOperation';

const props = defineProps<{
  files: ParsedFile[];
}>();

const message = useMessage();
const operation = useToolboxOperation();

const quality = ref(0.8);
const scaleRatio = ref(1.0);

const imageFormat = ref('image/webp');
const imageFormatOptions = [
  { label: '不改变图片格式', value: '' },
  { label: 'PNG', value: 'image/png' },
  { label: 'JPEG', value: 'image/jpeg' },
  { label: 'WEBP', value: 'image/webp' },
];

const selectedOptions = () => ({
  quality: quality.value,
  scaleRatio: Math.min(1, scaleRatio.value),
  selectedType: imageFormat.value,
});

type SelectedImageOptions = ReturnType<typeof selectedOptions>;

const encodeOptions = (
  blob: Blob,
  options: SelectedImageOptions,
): ImageEncodeOptions => ({
  outputType: resolveImageOutputType(blob.type, options.selectedType),
  quality: options.quality,
  scaleRatio: options.scaleRatio,
});

const compressImagesForEpub = async (
  epub: Epub,
  options: SelectedImageOptions,
  signal?: AbortSignal,
) => {
  const images = [...epub.iterImage()];
  const encoded = await encodeImageBatch(
    images.map(({ blob }) => blob),
    (blob) => encodeOptions(blob, options),
    { signal, concurrency: 2 },
  );
  throwIfImageProcessingAborted(signal);
  images.forEach((image, index) => epub.updateImage(image.id, encoded[index]!));
};

const compressImages = () => {
  const files = props.files.filter((file) => file.type === 'epub');
  const imageOptions = selectedOptions();
  return operation.run('压缩图片', files.length, (batchOptions) =>
    Toolbox.modifyFiles(
      files,
      (epub, signal) => compressImagesForEpub(epub, imageOptions, signal),
      batchOptions,
    ),
  );
};

interface EpubImage {
  id: string;
  href: string;
  uri: string;
  uriCompressed: string;
}
interface EpubDetail {
  name: string;
  images: EpubImage[];
  size: number;
  sizeCompressed: number;
  omitted: number;
}

const previewImageLimit = 24;
const getEpubDetailList = async (
  options: SelectedImageOptions,
  signal?: AbortSignal,
) => {
  const detailList: EpubDetail[] = [];
  try {
    for (const file of props.files) {
      if (file.type === 'epub') {
        const detail: EpubDetail = {
          name: file.name,
          images: [],
          size: 0,
          sizeCompressed: 0,
          omitted: 0,
        };
        detailList.push(detail);
        const images = [...file.iterImage()];
        const encoded = await encodeImageBatch(
          images.map(({ blob }) => blob),
          (blob) => encodeOptions(blob, options),
          { signal, concurrency: 2 },
        );
        throwIfImageProcessingAborted(signal);
        images.forEach((item, index) => {
          const blobCompressed = encoded[index]!;
          detail.size += item.blob.size;
          detail.sizeCompressed += blobCompressed.size;
          if (detail.images.length < previewImageLimit) {
            detail.images.push({
              id: item.id,
              href: item.href,
              uri: URL.createObjectURL(item.blob),
              uriCompressed: URL.createObjectURL(blobCompressed),
            });
          } else {
            detail.omitted += 1;
          }
        });
      }
    }
    return detailList;
  } catch (error) {
    revokeDetailList(detailList);
    throw error;
  }
};

const showDetail = ref(false);
const previewBusy = ref(false);
const detailList = ref<EpubDetail[]>([]);
let previewController: AbortController | undefined;
let previewRequest = 0;
const revokeDetailList = (details: EpubDetail[]) => {
  for (const detail of details) {
    for (const image of detail.images) {
      URL.revokeObjectURL(image.uri);
      URL.revokeObjectURL(image.uriCompressed);
    }
  }
};
const clearDetailList = () => {
  revokeDetailList(detailList.value);
  detailList.value = [];
  showCompare.value = false;
  compareImages.value = { old: '', new: '' };
};
const toggleShowDetail = async () => {
  if (previewBusy.value) {
    previewController?.abort(new DOMException('预览已取消', 'AbortError'));
    return;
  }
  if (showDetail.value) {
    showDetail.value = false;
    clearDetailList();
  } else {
    const request = ++previewRequest;
    const controller = new AbortController();
    previewController = controller;
    previewBusy.value = true;
    try {
      const details = await getEpubDetailList(
        selectedOptions(),
        controller.signal,
      );
      if (request !== previewRequest || controller.signal.aborted) {
        revokeDetailList(details);
        return;
      }
      clearDetailList();
      detailList.value = details;
      showDetail.value = true;
    } catch (error) {
      if (!controller.signal.aborted) message.error(`预览失败：${error}`);
    } finally {
      if (previewController === controller) {
        previewController = undefined;
        previewBusy.value = false;
      }
    }
  }
};

const showCompare = ref(false);
const compareImages = ref({ old: '', new: '' });
const showPreview = (image: EpubImage) => {
  showCompare.value = true;
  compareImages.value.old = image.uri;
  compareImages.value.new = image.uriCompressed;
};

watch([() => props.files, quality, scaleRatio, imageFormat], () => {
  previewRequest += 1;
  previewController?.abort(new DOMException('预览条件已变化', 'AbortError'));
  showDetail.value = false;
  clearDetailList();
});
onBeforeUnmount(() => {
  previewRequest += 1;
  previewController?.abort(new DOMException('页面已关闭', 'AbortError'));
  clearDetailList();
});
</script>

<template>
  <n-flex vertical>
    <c-action-wrapper title="格式">
      <c-radio-group
        v-model:value="imageFormat"
        :options="imageFormatOptions"
        size="small"
      />
    </c-action-wrapper>

    <c-action-wrapper title="压缩率" align="center">
      <n-slider
        v-model:value="quality"
        :max="1"
        :min="0.1"
        :step="0.05"
        :format-tooltip="(value: number) => `${(value * 100).toFixed(0)}%`"
        style="max-width: 400px"
      />
      <n-text style="width: 6em">{{ (quality * 100).toFixed(0) }}%</n-text>
    </c-action-wrapper>

    <c-action-wrapper title="尺寸" align="center">
      <n-slider
        v-model:value="scaleRatio"
        :max="1"
        :min="0.1"
        :step="0.05"
        :format-tooltip="(value: number) => `${(value * 100).toFixed(0)}%`"
        style="max-width: 400px"
      />
      <n-text style="width: 6em">{{ (scaleRatio * 100).toFixed(0) }}%</n-text>
    </c-action-wrapper>

    <n-button-group>
      <c-button
        label="压缩"
        :disabled="operation.state.busy || previewBusy"
        @action="compressImages"
      />
      <c-button
        :label="previewBusy ? '取消预览' : '预览效果'"
        :disabled="operation.state.busy"
        @action="toggleShowDetail"
      />
    </n-button-group>

    <n-text v-if="previewBusy" depth="3">
      正在生成预览（最多同时处理 2 张图片）…
    </n-text>

    <template v-if="showDetail">
      <n-text>点击图片预览压缩效果</n-text>
      <n-empty v-if="detailList.length === 0" description="未载入文件" />
      <template v-for="detail of detailList" :key="detail.name">
        <n-text>
          [{{ Humanize.bytes(detail.size) }}
          =>
          {{ Humanize.bytes(detail.sizeCompressed) }}]
          {{ detail.name }}
        </n-text>
        <n-text v-if="detail.omitted > 0" depth="3">
          为控制内存，仅展示前 {{ previewImageLimit }} 张，另有
          {{ detail.omitted }} 张已计入统计。
        </n-text>
        <c-x-scrollbar style="margin-top: 16px">
          <n-image-group show-toolbar-tooltip>
            <n-flex :size="4" :wrap="false" style="margin-bottom: 16px">
              <button
                v-for="image of detail.images"
                :key="image.id"
                class="image-preview-button"
                type="button"
                :aria-label="`对比 ${image.href}`"
                @click="showPreview(image)"
              >
                <n-image
                  height="150"
                  :src="image.uri"
                  preview-disabled
                  :alt="image.href"
                  style="border-radius: 2px"
                />
              </button>
            </n-flex>
          </n-image-group>
        </c-x-scrollbar>
      </template>
    </template>

    <c-modal
      v-model:show="showCompare"
      style="width: auto; max-width: 95%"
      :max-height-percentage="100"
    >
      <img-comparison-slider style="outline: none">
        <!-- eslint-disable -->
        <img
          slot="first"
          style="width: 100%; max-height: 85vh; object-fit: contain"
          :src="compareImages.old"
          alt="压缩前"
        />
        <img
          slot="second"
          style="width: 100%; max-height: 85vh; object-fit: contain"
          :src="compareImages.new"
          alt="压缩后"
        />
        <!-- eslint-enable -->
      </img-comparison-slider>
    </c-modal>
  </n-flex>
</template>

<style scoped>
.image-preview-button {
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.image-preview-button:focus-visible {
  outline: 2px solid currentcolor;
  outline-offset: 2px;
}
</style>
