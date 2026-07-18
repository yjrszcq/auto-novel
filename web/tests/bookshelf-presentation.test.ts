import { describe, expect, it } from 'vitest';

import type { BookshelfEntry } from '../src/pages/bookshelf/BookshelfService';
import {
  filterAndSortBookshelf,
  getContinueReadingBook,
  getReadingProgress,
  getTranslationProgress,
} from '../src/pages/bookshelf/BookshelfPresentation';

const entry = (
  id: string,
  {
    pinned = false,
    addedAt = 1,
    progress,
    translatedChapters = 0,
  }: {
    pinned?: boolean;
    addedAt?: number;
    progress?: BookshelfEntry['progress'];
    translatedChapters?: number;
  } = {},
): BookshelfEntry => ({
  volume: {
    id,
    createAt: addedAt,
    toc: [
      { chapterId: 'first', ...(translatedChapters > 0 ? { gpt: 'g' } : {}) },
      {
        chapterId: 'second',
        ...(translatedChapters > 1 ? { sakura: 's' } : {}),
      },
    ],
    glossaryId: 'glossary',
    glossary: {},
    favoredId: 'default',
    sourceFormat: 'epub',
    sourceBookMetadata: { title: id.replace(/\.[^.]+$/, '') },
  },
  state: {
    bookId: id,
    pinned,
    addedAt,
    updatedAt: addedAt,
  },
  progress,
});

describe('bookshelf presentation', () => {
  it('calculates separate stable reading and translation progress', () => {
    const book = entry('alpha.epub', {
      progress: {
        bookId: 'alpha.epub',
        chapterId: 'second',
        segmentId: 'segment',
        scrollRatio: 0.5,
        updatedAt: 30,
      },
      translatedChapters: 1,
    });

    expect(getReadingProgress(book)).toBe(75);
    expect(getTranslationProgress(book.volume)).toBe(50);
  });

  it('filters, sorts, pins, and selects the most recently read book', () => {
    const books = [
      entry('zeta.epub', {
        addedAt: 2,
        progress: { bookId: 'zeta.epub', chapterId: 'first', updatedAt: 20 },
      }),
      entry('alpha.epub', {
        pinned: true,
        addedAt: 1,
        progress: { bookId: 'alpha.epub', chapterId: 'second', updatedAt: 10 },
        translatedChapters: 2,
      }),
      entry('beta.epub', { addedAt: 3 }),
    ];

    expect(
      filterAndSortBookshelf(books, {
        query: '',
        filter: 'all',
        sort: 'title',
      }).map((book) => book.volume.id),
    ).toEqual(['alpha.epub', 'beta.epub', 'zeta.epub']);
    expect(
      filterAndSortBookshelf(books, {
        query: 'eta',
        filter: 'reading',
        sort: 'recent-read',
      }).map((book) => book.volume.id),
    ).toEqual(['zeta.epub']);
    expect(
      filterAndSortBookshelf(books, {
        query: '',
        filter: 'translated',
        sort: 'translation-progress',
      }).map((book) => book.volume.id),
    ).toEqual(['alpha.epub']);
    expect(getContinueReadingBook(books)?.volume.id).toBe('zeta.epub');
  });

  it('uses saved display metadata before the filename', () => {
    const book = entry('filename.epub');
    book.volume.bookMetadata = { title: '自定义书名' };
    expect(
      filterAndSortBookshelf([book], {
        query: '自定义',
        filter: 'all',
        sort: 'title',
      })[0].title,
    ).toBe('自定义书名');
  });
});
