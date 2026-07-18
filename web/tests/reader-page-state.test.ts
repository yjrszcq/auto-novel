import { describe, expect, it } from 'vitest';

import type {
  ReaderBook,
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderContentAdapter,
} from '../src/model/Reader';
import { createReaderPageController } from '../src/pages/reader/core/ReaderPageState';

const book = (id: string): ReaderBook => ({
  id,
  title: id,
  sourceLanguage: 'ja',
  requiresWholeChapterTranslation: true,
  targetLanguage: 'zh-CN',
  chapterCount: 1,
  createdAt: 1,
  updatedAt: 1,
});

const chapters = (bookId: string): ReaderChapterSummary[] => [
  {
    id: 'first',
    bookId,
    index: 0,
    title: 'first',
    hasOriginal: true,
    translationStatus: 'none',
    translatedSegmentCount: 0,
    totalSegmentCount: 1,
    translationSources: [],
  },
];

const content = (bookId: string): ReaderChapterContent => ({
  bookId,
  chapterId: 'first',
  chapterIndex: 0,
  title: 'first',
  segments: [{ id: 'segment', index: 0, original: '原文' }],
});

const createAdapter = (
  overrides: Partial<ReaderContentAdapter> = {},
): ReaderContentAdapter => ({
  getBook: async (bookId) => book(bookId),
  getChapters: async (bookId) => chapters(bookId),
  getChapter: async ({ bookId }) => content(bookId),
  getCapabilities: async () => ({
    hasOriginal: true,
    hasAnyTranslation: false,
    hasCompleteTranslation: false,
    translatedChapterCount: 0,
    totalChapterCount: 1,
    availableTranslationSources: [],
  }),
  ...overrides,
});

describe('reader page controller', () => {
  it('uses the first chapter for a book route without a chapter ID', async () => {
    const controller = createReaderPageController(createAdapter());

    await expect(controller.load('book')).resolves.toMatchObject({
      kind: 'ready',
      chapter: { chapterId: 'first' },
    });
  });

  it('returns a recoverable error for a missing chapter', async () => {
    const controller = createReaderPageController(createAdapter());

    await expect(controller.load('book', 'missing')).resolves.toEqual({
      kind: 'error',
      message: '章节不存在',
    });
  });

  it('marks an older load as stale when a newer navigation wins', async () => {
    let resolveFirst: ((value: ReaderBook) => void) | undefined;
    const firstBook = new Promise<ReaderBook>((resolve) => {
      resolveFirst = resolve;
    });
    const adapter = createAdapter({
      getBook: async (bookId) =>
        bookId === 'first' ? firstBook : book(bookId),
    });
    const controller = createReaderPageController(adapter);

    const firstLoad = controller.load('first');
    const secondLoad = controller.load('second');
    resolveFirst?.(book('first'));

    await expect(secondLoad).resolves.toMatchObject({
      kind: 'ready',
      book: { id: 'second' },
    });
    await expect(firstLoad).resolves.toEqual({ kind: 'stale' });
  });

  it('cancels an in-flight load when the reader is disposed', async () => {
    let resolveBook!: (value: ReaderBook) => void;
    const pendingBook = new Promise<ReaderBook>((resolve) => {
      resolveBook = resolve;
    });
    const controller = createReaderPageController(
      createAdapter({ getBook: async () => pendingBook }),
    );

    const pending = controller.load('book');
    controller.cancel();
    resolveBook(book('book'));

    await expect(pending).resolves.toEqual({ kind: 'stale' });
  });
});
