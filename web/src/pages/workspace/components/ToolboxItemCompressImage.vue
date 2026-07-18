<script lang="ts" setup>
import { ImgComparisonSlider } from '@img-comparison-slider/vue';

import { Humanize } from '@/util';
import type { Epub, ParsedFile } from '@/util/file';

import { Toolbox } from './Toolbox';
import { assertEncodedImageType, resolveImageOutputType } from './ToolboxImage';

const props = defineProps<{
  files: ParsedFile[];
}>();

const message = useMessage();

const quality = ref(0.8);
const scaleRatio = ref(1.0);

const imageFormat = ref('image/webp');
const imageFormatOptions = [
  { label: '不改变图片格式', value: '' },
  { label: 'PNG', value: 'image/png' },
  { label: 'JPEG', value: 'image/jpeg' },
  { label: 'WEBP', value: 'image/webp' },
];

const compressImage = async (blob: Blob) => {
  const canvas = document.createElement('canvas');
  const img = await createImageBitmap(blob);
  try {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('浏览器无法创建图片处理画布');
    const scaleRatioValue = Math.min(1, scaleRatio.value);
    canvas.width = Math.max(1, Math.round(img.width * scaleRatioValue));
    canvas.height = Math.max(1, Math.round(img.height * scaleRatioValue));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageFormatValue = resolveImageOutputType(
      blob.type,
      imageFormat.value,
    );
    const qualityValue = quality.value;
    const encoded = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (newBlob) =>
          newBlob === null
            ? reject(new Error(`压缩 ${blob.type || '图片'} 失败`))
            : resolve(newBlob),
        imageFormatValue,
        qualityValue,
      );
    });
    return assertEncodedImageType(encoded, imageFormatValue);
  } finally {
    img.close();
    canvas.width = 0;
    canvas.height = 0;
  }
};

const compressImagesForEpub = async (epub: Epub) => {
  for await (const item of epub.iterImage()) {
    const newBlob = await compressImage(item.blob);
    if (!newBlob)
      throw new Error(`压缩失败\n文件:${epub.name}\n图片:${item.href}`);
    epub.updateImage(item.id, newBlob);
  }
};

const compressImages = () =>
  Toolbox.modifyFiles(
    props.files.filter((file) => file.type === 'epub'),
    compressImagesForEpub,
    (e) => message.error(`发生错误：${e}`),
  );

interface EpubImage {
  id: string;
  href: string;
  blob: Blob;
  uri: string;
  blobCompressed: Blob | undefined;
  uriCompressed: string;
}
interface EpubDetail {
  name: string;
  images: EpubImage[];
  size: number;
  sizeCompressed: number;
  failed: number;
}

const getEpubDetailList = async () => {
  const detailList: EpubDetail[] = [];
  try {
    for (const file of props.files) {
      if (file.type === 'epub') {
        const detail: EpubDetail = {
          name: file.name,
          images: [],
          size: 0,
          sizeCompressed: 0,
          failed: 0,
        };
        for await (const item of file.iterImage()) {
          const blobCompressed = await compressImage(item.blob);
          detail.images.push({
            id: item.id,
            href: item.href,
            blob: item.blob,
            uri: URL.createObjectURL(item.blob),
            blobCompressed,
            uriCompressed: URL.createObjectURL(blobCompressed ?? item.blob),
          });
          detail.size += item.blob.size;
          detail.sizeCompressed += (blobCompressed ?? item.blob).size;
          if (!blobCompressed) detail.failed += 1;
        }
        detailList.push(detail);
      }
    }
    return detailList;
  } catch (error) {
    revokeDetailList(detailList);
    throw error;
  }
};

const showDetail = ref(false);
const detailList = ref<EpubDetail[]>([]);
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
  if (showDetail.value) {
    showDetail.value = false;
    clearDetailList();
  } else {
    try {
      const details = await getEpubDetailList();
      clearDetailList();
      detailList.value = details;
      showDetail.value = true;
    } catch (error) {
      message.error(`预览失败：${error}`);
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

watch(
  () => props.files,
  () => {
    showDetail.value = false;
    clearDetailList();
  },
);
onBeforeUnmount(clearDetailList);
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
      <c-button label="压缩" @action="compressImages" />
      <c-button label="预览效果" @action="toggleShowDetail" />
    </n-button-group>

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
        <c-x-scrollbar style="margin-top: 16px">
          <n-image-group show-toolbar-tooltip>
            <n-flex :size="4" :wrap="false" style="margin-bottom: 16px">
              <n-image
                v-for="image of detail.images"
                :key="image.id"
                height="150"
                :src="image.uri"
                preview-disabled
                :alt="image.id"
                style="border-radius: 2px"
                @click="showPreview(image)"
              />
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
