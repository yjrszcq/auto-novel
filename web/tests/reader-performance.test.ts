import type { ReaderContentAdapter } from '../src/model/Reader';

import { describe, expect, it, vi } from 'vitest';

import { createCachedReaderContentAdapter } from '../src/pages/reader/core/ReaderContentCache';
import { createReaderPageController } from '../src/pages/reader/core/ReaderPageState';

const createChapter = (chapterId: string) => ({
  bookId: 'book',
  chapterId,
  chapterIndex: Number(chapterId),
  title: chapterId,
  segments: [],
});

describe('reader performance helpers', () => {
  it('deduplicates chapter loads and evicts least-recently-used entries', async () => {
    const getChapter = vi.fn(async ({ chapterId }: { chapterId: string }) =>
      createChapter(chapterId),
    );
    const adapter = {
      getBook: vi.fn(),
      getChapters: vi.fn(),
      getChapter,
      getCapabilities: vi.fn(),
    } as unknown as ReaderContentAdapter;
    const cached = createCachedReaderContentAdapter(adapter, 2);

    await Promise.all([
      cached.getChapter({ bookId: 'book', chapterId: '0' }),
      cached.getChapter({ bookId: 'book', chapterId: '0' }),
    ]);
    expect(getChapter).toHaveBeenCalledTimes(1);

    await cached.getChapter({ bookId: 'book', chapterId: '1' });
    await cached.getChapter({ bookId: 'book', chapterId: '2' });
    await cached.getChapter({ bookId: 'book', chapterId: '0' });
    expect(getChapter).toHaveBeenCalledTimes(4);

    cached.invalidateChapter({ bookId: 'book', chapterId: '0' });
    await cached.getChapter({ bookId: 'book', chapterId: '0' });
    expect(getChapter).toHaveBeenCalledTimes(5);
  });

  it('prefetches only adjacent chapters when the adapter supports it', async () => {
    const preloadChapter = vi.fn();
    const adapter: ReaderContentAdapter = {
      getBook: async () => ({
        id: 'book',
        title: 'book',
        sourceLanguage: 'ja',
        chapterCount: 3,
        createdAt: 0,
        updatedAt: 0,
      }),
      getChapters: async () => [
        {
          id: '0',
          bookId: 'book',
          index: 0,
          title: '0',
          hasOriginal: true,
          translationStatus: 'none',
          translatedSegmentCount: 0,
          totalSegmentCount: 1,
          translationSources: [],
        },
        {
          id: '1',
          bookId: 'book',
          index: 1,
          title: '1',
          hasOriginal: true,
          translationStatus: 'none',
          translatedSegmentCount: 0,
          totalSegmentCount: 1,
          translationSources: [],
        },
        {
          id: '2',
          bookId: 'book',
          index: 2,
          title: '2',
          hasOriginal: true,
          translationStatus: 'none',
          translatedSegmentCount: 0,
          totalSegmentCount: 1,
          translationSources: [],
        },
      ],
      getChapter: async ({ chapterId }) => createChapter(chapterId),
      getCapabilities: async () => ({
        hasOriginal: true,
        hasAnyTranslation: false,
        hasCompleteTranslation: false,
        translatedChapterCount: 0,
        totalChapterCount: 3,
        availableTranslationSources: [],
      }),
      preloadChapter,
    };

    await createReaderPageController(adapter).load('book', '1');
    expect(preloadChapter).toHaveBeenCalledTimes(2);
    expect(preloadChapter).toHaveBeenCalledWith({
      bookId: 'book',
      chapterId: '0',
    });
    expect(preloadChapter).toHaveBeenCalledWith({
      bookId: 'book',
      chapterId: '2',
    });
  });
});
