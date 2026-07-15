import { describe, expect, it } from 'vitest';

import {
  createReaderBookmark,
  findBookmarkAtSegment,
  getBookmarkTarget,
  sortReaderBookmarks,
} from '../src/pages/reader/core/ReaderBookmarks';

describe('reader bookmarks', () => {
  it('creates stable segment bookmarks and locates the active one', () => {
    const bookmark = createReaderBookmark({
      id: 'bookmark-1',
      now: 10,
      bookId: 'book',
      chapterId: 'chapter',
      segmentId: 'segment',
      label: '第一章',
    });

    expect(bookmark).toEqual({
      id: 'bookmark-1',
      bookId: 'book',
      chapterId: 'chapter',
      segmentId: 'segment',
      label: '第一章',
      createdAt: 10,
    });
    expect(findBookmarkAtSegment([bookmark], 'chapter', 'segment')).toBe(
      bookmark,
    );
  });

  it('orders bookmarks by recency and provides an exact jump target', () => {
    const older = createReaderBookmark({
      id: 'older',
      now: 1,
      bookId: 'book',
      chapterId: 'one',
      segmentId: 'first',
    });
    const newer = createReaderBookmark({
      id: 'newer',
      now: 2,
      bookId: 'book',
      chapterId: 'two',
      segmentId: 'second',
    });

    expect(sortReaderBookmarks([older, newer]).map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
    expect(getBookmarkTarget(newer)).toEqual({
      chapterId: 'two',
      segmentId: 'second',
    });
  });
});
