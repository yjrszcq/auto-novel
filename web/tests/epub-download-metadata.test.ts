import { describe, expect, it, vi } from 'vitest';

import type { LocalVolumeMetadata } from '../src/model/LocalVolume';
import { embedEpubDownloadMetadata } from '../src/stores/local/EpubDownloadMetadata';

const volume = (coverUrl?: string): LocalVolumeMetadata => ({
  id: 'book.epub',
  createAt: 1,
  toc: [],
  glossaryId: 'glossary',
  glossary: {},
  favoredId: 'default',
  sourceBookMetadata: {
    title: '原始标题',
    authors: ['原始作者'],
    languages: ['ja'],
  },
  bookMetadata: {
    title: '展示标题',
    authors: [],
    description: '',
    coverUrl,
    languages: ['zh-CN'],
  },
});

describe('EPUB download metadata', () => {
  it('embeds effective metadata and a custom cover without changing source state', async () => {
    const customCover = new Blob(['custom'], { type: 'image/png' });
    const epub = {
      updateBookMetadata: vi.fn(),
      setCover: vi.fn(),
    };
    const dao = {
      getReaderCover: vi.fn().mockResolvedValue({
        bookId: 'book.epub',
        blob: customCover,
        source: 'custom',
        updatedAt: 1,
      }),
    };

    await embedEpubDownloadMetadata(dao as never, epub as never, volume());

    expect(epub.updateBookMetadata).toHaveBeenCalledWith({
      title: '展示标题',
      authors: [],
      description: '',
      languages: ['zh-CN'],
    });
    expect(epub.setCover).toHaveBeenCalledWith(customCover);
  });

  it('uses a cover URL before the saved custom cover', async () => {
    const linkedCover = new Blob(['linked'], { type: 'image/jpeg' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(linkedCover),
      }),
    );
    const epub = {
      updateBookMetadata: vi.fn(),
      setCover: vi.fn(),
    };
    const dao = { getReaderCover: vi.fn() };

    await embedEpubDownloadMetadata(
      dao as never,
      epub as never,
      volume('https://example.com/cover.jpg'),
    );

    expect(epub.setCover).toHaveBeenCalledWith(linkedCover);
    expect(dao.getReaderCover).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the original EPUB cover when no override cover exists', async () => {
    const epub = {
      updateBookMetadata: vi.fn(),
      setCover: vi.fn(),
    };
    const dao = { getReaderCover: vi.fn().mockResolvedValue(undefined) };

    await embedEpubDownloadMetadata(dao as never, epub as never, volume());

    expect(epub.setCover).not.toHaveBeenCalled();
  });
});
