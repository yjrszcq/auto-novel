import { describe, expect, it } from 'vitest';

import {
  assertEncodedImageType,
  isCanvasImageType,
  resolveImageOutputType,
} from '../src/pages/workspace/components/ToolboxImage';

describe('toolbox image processing', () => {
  it('preserves supported source formats when keep-format is selected', () => {
    expect(resolveImageOutputType('image/jpeg', '')).toBe('image/jpeg');
    expect(resolveImageOutputType('image/png', '')).toBe('image/png');
    expect(resolveImageOutputType('image/webp', '')).toBe('image/webp');
  });

  it('uses an explicit supported output format', () => {
    expect(resolveImageOutputType('image/gif', 'image/webp')).toBe(
      'image/webp',
    );
    expect(isCanvasImageType('image/svg+xml')).toBe(false);
  });

  it('rejects unsupported preservation and silent encoder fallback', () => {
    expect(() => resolveImageOutputType('image/gif', '')).toThrow(
      '无法保持 image/gif 图片格式',
    );
    expect(() =>
      assertEncodedImageType(
        new Blob(['png fallback'], { type: 'image/png' }),
        'image/webp',
      ),
    ).toThrow('浏览器无法编码 image/webp 图片');
  });
});
