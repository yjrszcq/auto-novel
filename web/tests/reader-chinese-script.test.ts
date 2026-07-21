import { describe, expect, it, vi } from 'vitest';

import { createReaderChineseScriptService } from '../src/pages/reader/core/ReaderChineseScript';

describe('reader Chinese script conversion', () => {
  it('uses standard OpenCC contextual conversion without regional phrases', async () => {
    const service = createReaderChineseScriptService();

    await expect(
      service.convert({
        bookId: 'book',
        script: 'traditional',
        text: '头发发展在里面，互联网占用内存。',
      }),
    ).resolves.toBe('頭髮發展在裏面，互聯網佔用內存。');
    await expect(
      service.convert({
        bookId: 'book',
        script: 'simplified',
        text: '頭髮發展在裏面，互聯網佔用內存。',
      }),
    ).resolves.toBe('头发发展在里面，互联网占用内存。');
  });

  it('does not load OpenCC when conversion is disabled', async () => {
    const load = vi.fn();
    const service = createReaderChineseScriptService({ load });

    await expect(
      service.convert({ bookId: 'book', script: 'none', text: '头发' }),
    ).resolves.toBe('头发');
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps a bounded LRU cache and releases one book independently', async () => {
    const convert = vi.fn((text: string) => `converted:${text}`);
    const load = vi.fn(async () => ({
      simplified: convert,
      traditional: convert,
    }));
    const service = createReaderChineseScriptService({
      maximumEntries: 2,
      load,
    });
    const request = (bookId: string, text: string) =>
      service.convert({ bookId, script: 'traditional', text });

    await request('a', 'one');
    await request('a', 'two');
    await request('a', 'one');
    await request('b', 'three');
    await request('a', 'two');
    expect(convert).toHaveBeenCalledTimes(4);

    service.releaseBook('a');
    await request('b', 'three');
    await request('a', 'one');
    expect(convert).toHaveBeenCalledTimes(5);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries a transient lazy-module failure', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary chunk failure'))
      .mockResolvedValue({
        simplified: (text: string) => text,
        traditional: (text: string) => `converted:${text}`,
      });
    const service = createReaderChineseScriptService({ load });
    const request = () =>
      service.convert({
        bookId: 'book',
        script: 'traditional',
        text: 'text',
      });

    await expect(request()).rejects.toThrow('temporary chunk failure');
    await expect(request()).resolves.toBe('converted:text');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
