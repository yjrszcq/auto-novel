import { describe, expect, it, vi } from 'vitest';

import {
  createReaderProgress,
  resolveProgressSegment,
} from '../src/pages/reader/core/ReaderProgress';

describe('reader progress', () => {
  it('restores a stable segment before any legacy pixel position', () => {
    const segments = [
      { id: 'first', index: 0, original: '一' },
      { id: 'second', index: 1, original: '二' },
    ];

    expect(
      resolveProgressSegment(segments, {
        bookId: 'book',
        chapterId: 'chapter',
        segmentId: 'second',
        legacyScrollY: 999,
        updatedAt: 1,
      }),
    ).toMatchObject({ id: 'second' });
    expect(
      resolveProgressSegment(segments, {
        bookId: 'book',
        chapterId: 'chapter',
        legacyScrollY: 999,
        updatedAt: 1,
      }),
    ).toBeUndefined();
  });

  it('creates a clamped stable position record', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(123));
    expect(
      createReaderProgress({
        bookId: 'book',
        chapterId: 'chapter',
        segmentId: 'segment',
        scrollRatio: 2,
      }),
    ).toMatchObject({
      bookId: 'book',
      chapterId: 'chapter',
      segmentId: 'segment',
      scrollRatio: 1,
      updatedAt: 123,
    });
    vi.useRealTimers();
  });
});
