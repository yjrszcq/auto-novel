import { describe, expect, it, vi } from 'vitest';

import {
  assertEncodedImageType,
  encodeImageBatch,
  isCanvasImageType,
  mapWithConcurrency,
  resolveImageOutputType,
  type ImageEncoder,
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

  it('bounds concurrency and preserves input order', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const resultPromise = mapWithConcurrency([0, 1, 2, 3], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 2;
    });

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());

    await expect(resultPromise).resolves.toEqual([0, 2, 4, 6]);
    expect(peak).toBe(2);
  });

  it('terminates the encoder and starts no new work after cancellation', async () => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encoder: ImageEncoder = {
      encode: vi.fn(async () => {
        await gate;
        return new Blob(['encoded'], { type: 'image/png' });
      }),
      dispose: vi.fn(),
    };
    const result = encodeImageBatch(
      [new Blob(['a']), new Blob(['b']), new Blob(['c'])],
      () => ({ outputType: 'image/png', quality: 0.8, scaleRatio: 1 }),
      { concurrency: 2, encoder, signal: controller.signal },
    );

    await vi.waitFor(() => expect(encoder.encode).toHaveBeenCalledTimes(2));
    controller.abort();
    release?.();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(encoder.encode).toHaveBeenCalledTimes(2);
    expect(encoder.dispose).toHaveBeenCalled();
  });
});
