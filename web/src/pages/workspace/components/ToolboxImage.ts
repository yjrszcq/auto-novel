export const canvasImageTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type CanvasImageType = (typeof canvasImageTypes)[number];

export const isCanvasImageType = (value: string): value is CanvasImageType =>
  canvasImageTypes.includes(value as CanvasImageType);

export const resolveImageOutputType = (
  sourceType: string,
  selectedType: string,
): CanvasImageType => {
  const outputType = selectedType || sourceType;
  if (!isCanvasImageType(outputType)) {
    throw new Error(
      selectedType
        ? `浏览器不支持输出 ${selectedType}`
        : `无法保持 ${sourceType || '未知'} 图片格式，请选择 PNG、JPEG 或 WEBP`,
    );
  }
  return outputType;
};

export const assertEncodedImageType = (
  blob: Blob,
  expectedType: CanvasImageType,
) => {
  if (blob.type !== expectedType) {
    throw new Error(`浏览器无法编码 ${expectedType} 图片`);
  }
  return blob;
};

export interface ImageEncodeOptions {
  outputType: CanvasImageType;
  quality: number;
  scaleRatio: number;
}

export interface ImageEncoder {
  encode: (
    blob: Blob,
    options: ImageEncodeOptions,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  dispose: (reason?: unknown) => void;
}

const abortError = () => new DOMException('图片处理已取消', 'AbortError');

export const throwIfImageProcessingAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? abortError();
};

export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  process: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('图片处理并发数必须是正整数');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      throwIfImageProcessingAborted(signal);
      const index = nextIndex++;
      const result = await process(items[index]!, index);
      throwIfImageProcessingAborted(signal);
      results[index] = result;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
};

export const encodeImageOnMainThread = async (
  blob: Blob,
  options: ImageEncodeOptions,
  signal?: AbortSignal,
) => {
  throwIfImageProcessingAborted(signal);
  const canvas = document.createElement('canvas');
  const image = await createImageBitmap(blob);
  try {
    throwIfImageProcessingAborted(signal);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('浏览器无法创建图片处理画布');
    canvas.width = Math.max(1, Math.round(image.width * options.scaleRatio));
    canvas.height = Math.max(1, Math.round(image.height * options.scaleRatio));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result === null
            ? reject(new Error(`压缩 ${blob.type || '图片'} 失败`))
            : resolve(result),
        options.outputType,
        options.quality,
      );
    });
    throwIfImageProcessingAborted(signal);
    return assertEncodedImageType(encoded, options.outputType);
  } finally {
    image.close();
    canvas.width = 0;
    canvas.height = 0;
  }
};

interface WorkerResponse {
  id: number;
  buffer?: ArrayBuffer;
  type?: string;
  error?: string;
}

class WorkerImageEncoder implements ImageEncoder {
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (blob: Blob) => void; reject: (error: unknown) => void }
  >();
  private disposed = false;

  constructor(private readonly worker: Worker) {
    worker.addEventListener(
      'message',
      (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        const pending = this.pending.get(response.id);
        if (pending === undefined) return;
        this.pending.delete(response.id);
        if (response.error !== undefined) {
          pending.reject(new Error(response.error));
        } else if (
          response.buffer === undefined ||
          response.type === undefined
        ) {
          pending.reject(new Error('图片工作线程返回了无效结果'));
        } else {
          pending.resolve(new Blob([response.buffer], { type: response.type }));
        }
      },
    );
    worker.addEventListener('error', (event) => {
      this.dispose(new Error(event.message || '图片工作线程异常'));
    });
  }

  async encode(blob: Blob, options: ImageEncodeOptions, signal?: AbortSignal) {
    throwIfImageProcessingAborted(signal);
    if (this.disposed) throw new Error('图片工作线程已关闭');
    const buffer = await blob.arrayBuffer();
    throwIfImageProcessingAborted(signal);
    const id = this.nextId++;
    const result = new Promise<Blob>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.worker.postMessage({ id, buffer, sourceType: blob.type, options }, [
      buffer,
    ]);
    return result;
  }

  dispose(reason: unknown = new Error('图片工作线程已关闭')) {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.pending.forEach(({ reject }) => reject(reason));
    this.pending.clear();
  }
}

const createDefaultEncoder = (): ImageEncoder => {
  if (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  ) {
    try {
      return new WorkerImageEncoder(
        new Worker(new URL('./ToolboxImage.worker.ts', import.meta.url), {
          type: 'module',
          name: 'toolbox-image-encoder',
        }),
      );
    } catch {
      // Fall through to the main-thread compatibility path.
    }
  }
  return {
    encode: encodeImageOnMainThread,
    dispose: () => undefined,
  };
};

export const encodeImageBatch = async (
  blobs: readonly Blob[],
  optionsFor: (blob: Blob, index: number) => ImageEncodeOptions,
  options: {
    signal?: AbortSignal;
    concurrency?: number;
    encoder?: ImageEncoder;
  } = {},
) => {
  const encoder = options.encoder ?? createDefaultEncoder();
  const abort = () => encoder.dispose(options.signal?.reason ?? abortError());
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await mapWithConcurrency(
      blobs,
      options.concurrency ?? 2,
      async (blob, index) => {
        const imageOptions = optionsFor(blob, index);
        try {
          return assertEncodedImageType(
            await encoder.encode(blob, imageOptions, options.signal),
            imageOptions.outputType,
          );
        } catch (error) {
          throwIfImageProcessingAborted(options.signal);
          if (encoder instanceof WorkerImageEncoder) {
            return encodeImageOnMainThread(blob, imageOptions, options.signal);
          }
          throw error;
        }
      },
      options.signal,
    );
  } finally {
    options.signal?.removeEventListener('abort', abort);
    encoder.dispose();
  }
};
