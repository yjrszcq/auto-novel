import {
  getLocalVolumeTitle,
  type LocalVolumeMetadata,
} from '@/model/LocalVolume';

import type { BookshelfEntry } from './BookshelfService';

export type BookshelfFilter =
  | 'all'
  | 'unread'
  | 'reading'
  | 'translated'
  | 'untranslated';

export type BookshelfSort =
  | 'recent-read'
  | 'added'
  | 'title'
  | 'reading-progress'
  | 'translation-progress';

export interface BookshelfDisplayBook extends BookshelfEntry {
  title: string;
  readingProgress: number;
  translationProgress: number;
  lastReadAt?: number;
}

const translationKeys = ['gpt', 'sakura', 'youdao', 'baidu'] as const;

export const getBookTitle = (volume: LocalVolumeMetadata) =>
  getLocalVolumeTitle(volume);

const clamp = (value: number) => Math.max(0, Math.min(value, 100));

export const getReadingProgress = (entry: BookshelfEntry) => {
  const progress = entry.progress;
  const chapters = entry.volume.toc;
  if (progress === undefined || chapters.length === 0) {
    return 0;
  }
  const chapterIndex = chapters.findIndex(
    (chapter) => chapter.chapterId === progress.chapterId,
  );
  if (chapterIndex < 0) {
    return 0;
  }
  const chapterRatio = clamp((progress.scrollRatio ?? 0) * 100) / 100;
  return clamp(((chapterIndex + chapterRatio) / chapters.length) * 100);
};

export const getTranslationProgress = (volume: LocalVolumeMetadata) => {
  if (volume.toc.length === 0) {
    return 0;
  }
  const translatedChapters = volume.toc.filter((chapter) =>
    translationKeys.some((translator) => chapter[translator] !== undefined),
  ).length;
  return (translatedChapters / volume.toc.length) * 100;
};

export const toBookshelfDisplayBook = (
  entry: BookshelfEntry,
): BookshelfDisplayBook => ({
  ...entry,
  title: getBookTitle(entry.volume),
  readingProgress: getReadingProgress(entry),
  translationProgress: getTranslationProgress(entry.volume),
  lastReadAt: entry.progress?.updatedAt ?? entry.volume.readAt,
});

const compareNumbers = (left: number, right: number) => right - left;

export const filterAndSortBookshelf = (
  entries: BookshelfEntry[],
  {
    query,
    filter,
    sort,
  }: {
    query: string;
    filter: BookshelfFilter;
    sort: BookshelfSort;
  },
): BookshelfDisplayBook[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const books = entries.map(toBookshelfDisplayBook).filter((book) => {
    if (
      normalizedQuery.length > 0 &&
      !book.title.toLocaleLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    if (filter === 'unread') {
      return book.progress === undefined;
    }
    if (filter === 'reading') {
      return book.progress !== undefined;
    }
    if (filter === 'translated') {
      return book.translationProgress === 100;
    }
    if (filter === 'untranslated') {
      return book.translationProgress === 0;
    }
    return true;
  });

  return books.sort((left, right) => {
    if (left.state.pinned !== right.state.pinned) {
      return left.state.pinned ? -1 : 1;
    }
    switch (sort) {
      case 'recent-read':
        return compareNumbers(left.lastReadAt ?? 0, right.lastReadAt ?? 0);
      case 'added':
        return compareNumbers(left.state.addedAt, right.state.addedAt);
      case 'title':
        return left.title.localeCompare(right.title, 'zh-CN');
      case 'reading-progress':
        return compareNumbers(left.readingProgress, right.readingProgress);
      case 'translation-progress':
        return compareNumbers(
          left.translationProgress,
          right.translationProgress,
        );
    }
  });
};

export const getContinueReadingBook = (entries: BookshelfEntry[]) =>
  entries
    .filter((entry) => entry.progress !== undefined)
    .map(toBookshelfDisplayBook)
    .sort((left, right) =>
      compareNumbers(left.lastReadAt ?? 0, right.lastReadAt ?? 0),
    )[0];
