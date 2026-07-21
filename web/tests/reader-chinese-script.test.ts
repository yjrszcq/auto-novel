import { describe, expect, it, vi } from 'vitest';

import {
  convertReaderSegments,
  convertReaderTextParts,
  createReaderChineseScriptService,
  getReaderChineseScriptSides,
} from '../src/pages/reader/core/ReaderChineseScript';

describe('reader Chinese script conversion', () => {
  it('selects only the Chinese language side for each kind of book', () => {
    expect(getReaderChineseScriptSides(false)).toEqual({
      original: true,
      translated: false,
    });
    expect(getReaderChineseScriptSides(true)).toEqual({
      original: false,
      translated: true,
    });
  });

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

  it('converts only the requested segment side without mutating source data', async () => {
    const segments = [
      { id: 'segment', index: 0, original: '头发', translated: '发展' },
    ];
    const converted = await convertReaderSegments({
      bookId: 'book',
      script: 'traditional',
      segments,
      original: false,
      translated: true,
    });

    expect(converted).toEqual([
      { id: 'segment', index: 0, original: '头发', translated: '發展' },
    ]);
    expect(segments[0]).toEqual({
      id: 'segment',
      index: 0,
      original: '头发',
      translated: '发展',
    });
  });

  it('keeps the original segment array when conversion is disabled', async () => {
    const segments = [{ id: 'segment', index: 0, original: '头发发展在里面' }];

    await expect(
      convertReaderSegments({
        bookId: 'book-disabled',
        script: 'none',
        segments,
        original: true,
        translated: false,
      }),
    ).resolves.toBe(segments);
  });

  it('preserves phrase context split across EPUB text nodes', async () => {
    await expect(
      convertReaderTextParts({
        bookId: 'epub',
        script: 'traditional',
        parts: ['头', '发与发', '展'],
      }),
    ).resolves.toEqual(['頭', '髮與發', '展']);
  });
});
