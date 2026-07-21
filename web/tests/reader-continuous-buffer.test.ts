import { describe, expect, it } from 'vitest';

import {
  getReaderContinuousBufferTarget,
  planReaderContinuousBuffer,
  readerContinuousBufferMaxChaptersPerDirection,
  readerContinuousBufferMaxSegmentsPerDirection,
  readerContinuousBufferSegmentBatchSize,
  type ReaderContinuousBufferState,
} from '../src/pages/reader/core/ReaderContinuousBuffer';

const state = (
  overrides: Partial<ReaderContinuousBufferState> = {},
): ReaderContinuousBufferState => ({
  renderedHeight: 0,
  targetHeight: 1_000,
  chapterCount: 1,
  segmentCount: readerContinuousBufferSegmentBatchSize,
  currentChapterRemainingSegments: 0,
  hasAdjacentChapter: true,
  ...overrides,
});
describe('reader continuous buffer planning', () => {
  it('uses independent viewport-relative targets in both directions', () => {
    expect(getReaderContinuousBufferTarget(800, 'previous')).toBe(1_200);
    expect(getReaderContinuousBufferTarget(800, 'next')).toBe(2_000);
  });

  it('stops as soon as measured content fills the target', () => {
    expect(
      planReaderContinuousBuffer(
        state({ renderedHeight: 1_000, currentChapterRemainingSegments: 200 }),
      ),
    ).toEqual({ kind: 'stop', reason: 'filled' });
  });

  it('expands a long chapter before loading another chapter', () => {
    expect(
      planReaderContinuousBuffer(
        state({ currentChapterRemainingSegments: 100 }),
      ),
    ).toEqual({
      kind: 'expand-segments',
      count: readerContinuousBufferSegmentBatchSize,
    });
  });

  it('loads successive short chapters until their measured height is enough', () => {
    let chapterCount = 1;
    let renderedHeight = 60;
    const decisions: string[] = [];
    while (renderedHeight < 300) {
      const decision = planReaderContinuousBuffer(
        state({ chapterCount, renderedHeight, targetHeight: 300 }),
      );
      decisions.push(decision.kind);
      expect(decision.kind).toBe('load-chapter');
      chapterCount += 1;
      renderedHeight += 60;
    }
    expect(decisions).toEqual([
      'load-chapter',
      'load-chapter',
      'load-chapter',
      'load-chapter',
    ]);
    expect(
      planReaderContinuousBuffer(
        state({ chapterCount, renderedHeight, targetHeight: 300 }),
      ),
    ).toEqual({ kind: 'stop', reason: 'filled' });
  });

  it('allows natural underfill at the beginning or end of a book', () => {
    expect(
      planReaderContinuousBuffer(state({ hasAdjacentChapter: false })),
    ).toEqual({ kind: 'stop', reason: 'book-boundary' });
  });

  it('stops pathological short-chapter chains at the chapter limit', () => {
    expect(
      planReaderContinuousBuffer(
        state({
          chapterCount: readerContinuousBufferMaxChaptersPerDirection,
        }),
      ),
    ).toEqual({ kind: 'stop', reason: 'chapter-limit' });
  });

  it('clamps the final expansion to the remaining segment budget', () => {
    expect(
      planReaderContinuousBuffer(
        state({
          segmentCount: readerContinuousBufferMaxSegmentsPerDirection - 5,
          currentChapterRemainingSegments: 20,
        }),
      ),
    ).toEqual({ kind: 'expand-segments', count: 5 });
    expect(
      planReaderContinuousBuffer(
        state({
          segmentCount: readerContinuousBufferMaxSegmentsPerDirection,
          currentChapterRemainingSegments: 20,
        }),
      ),
    ).toEqual({ kind: 'stop', reason: 'segment-limit' });
  });
});
