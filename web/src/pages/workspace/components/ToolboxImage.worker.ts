/// <reference lib="webworker" />

import type { ImageEncodeOptions } from './ToolboxImage';

interface EncodeRequest {
  id: number;
  buffer: ArrayBuffer;
  sourceType: string;
  options: ImageEncodeOptions;
}

const scope: DedicatedWorkerGlobalScope = self;

scope.addEventListener(
  'message',
  async (event: MessageEvent<EncodeRequest>) => {
    const { id, buffer, sourceType, options } = event.data;
    let image: ImageBitmap | undefined;
    try {
      image = await createImageBitmap(new Blob([buffer], { type: sourceType }));
      const width = Math.max(1, Math.round(image.width * options.scaleRatio));
      const height = Math.max(1, Math.round(image.height * options.scaleRatio));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('工作线程无法创建图片处理画布');
      context.drawImage(image, 0, 0, width, height);
      const blob = await canvas.convertToBlob({
        type: options.outputType,
        quality: options.quality,
      });
      if (blob.type !== options.outputType) {
        throw new Error(`浏览器无法编码 ${options.outputType} 图片`);
      }
      const result = await blob.arrayBuffer();
      scope.postMessage({ id, buffer: result, type: blob.type }, [result]);
    } catch (error) {
      scope.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      image?.close();
    }
  },
);
