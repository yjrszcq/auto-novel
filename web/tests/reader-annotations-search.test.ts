import { describe, expect, it, vi } from 'vitest';

import type {
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderContentAdapter,
} from '../src/model/Reader';

import {
  createReaderSearchController,
  searchReaderChapters,
} from '../src/pages/reader/core/ReaderSearch';

const createChapterSummary = (index: number): ReaderChapterSummary => ({
  id: `chapter-${index}`,
  bookId: 'book',
  index,
  title: `章节${index}`,
  hasOriginal: true,
  translationStatus: 'none',
  translatedSegmentCount: 0,
  totalSegmentCount: 1,
  translationSources: [],
});

const createChapterContent = (chapterId: string): ReaderChapterContent => ({
  bookId: 'book',
  chapterId,
  chapterIndex: Number(chapterId.replace('chapter-', '')),
  title: chapterId,
  segments: [
    {
      id: `segment-${chapterId}`,
      index: 0,
      original: `命中 ${chapterId}`,
    },
  ],
});

describe('local reader search', () => {
  it('searches local original and translated segments with stable jump targets', async () => {
    await expect(
      searchReaderChapters(
        [
          {
            bookId: 'book',
            chapterId: 'chapter',
            chapterIndex: 0,
            title: '第一章',
            segments: [
              {
                id: 'segment',
                index: 0,
                original: 'hello world',
                translated: '你好世界',
              },
            ],
          },
        ],
        '世界',
      ),
    ).resolves.toEqual([
      {
        chapterId: 'chapter',
        chapterTitle: '第一章',
        segmentId: 'segment',
        languageSide: 'translated',
        excerpt: '你好世界',
      },
    ]);
  });

  it('bounds search output', async () => {
    const chapters = Array.from({ length: 1_000 }, (_, index) => ({
      bookId: 'book',
      chapterId: `${index}`,
      chapterIndex: index,
      title: `章节${index}`,
      segments: [
        {
          id: `segment-${index}`,
          index: 0,
          original: `命中${index}`,
        },
      ],
    }));
    await expect(
      searchReaderChapters(chapters, '命中', 25),
    ).resolves.toHaveLength(25);
  });

  it('matches simplified and traditional forms while preserving stable targets', async () => {
    const chapter = {
      bookId: 'book',
      chapterId: 'chapter',
      chapterIndex: 0,
      title: '第一章',
      segments: [{ id: 'stable-id', index: 0, original: '頭髮在裏面發展' }],
    };
    await expect(
      searchReaderChapters([chapter], '头发在里面发展', 10, {
        excerptScript: 'simplified',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        chapterId: 'chapter',
        segmentId: 'stable-id',
        languageSide: 'original',
        excerpt: '头发在里面发展',
      }),
    ]);
  });

  it('loads search batches only until the configured result cap is reached', async () => {
    const getChapter = vi.fn(async ({ chapterId }: { chapterId: string }) =>
      createChapterContent(chapterId),
    );
    const controller = createReaderSearchController(
      { getChapter } as unknown as ReaderContentAdapter,
      { batchSize: 4, maximumResults: 5 },
    );

    await expect(
      controller.search({
        bookId: 'book',
        chapters: Array.from({ length: 100 }, (_, index) =>
          createChapterSummary(index),
        ),
        query: '命中',
      }),
    ).resolves.toMatchObject({
      kind: 'results',
      truncated: true,
      results: expect.arrayContaining([
        expect.objectContaining({ chapterId: 'chapter-0' }),
      ]),
    });
    expect(getChapter).toHaveBeenCalledTimes(8);
  });

  it('cancels a stale search before it loads another batch', async () => {
    let releaseFirstBatch!: () => void;
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    const getChapter = vi.fn(async ({ chapterId }: { chapterId: string }) => {
      await firstBatch;
      return createChapterContent(chapterId);
    });
    const controller = createReaderSearchController(
      { getChapter } as unknown as ReaderContentAdapter,
      { batchSize: 4, maximumResults: 20 },
    );
    const pending = controller.search({
      bookId: 'book',
      chapters: Array.from({ length: 100 }, (_, index) =>
        createChapterSummary(index),
      ),
      query: '不存在',
    });

    controller.cancel();
    releaseFirstBatch();

    await expect(pending).resolves.toEqual({ kind: 'stale' });
    expect(getChapter).toHaveBeenCalledTimes(4);
  });
});
