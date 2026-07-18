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
