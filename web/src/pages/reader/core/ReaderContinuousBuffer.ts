export type ReaderContinuousBufferDirection = 'previous' | 'next';

export const readerContinuousBufferSegmentBatchSize = 24;
export const readerContinuousBufferMaxChaptersPerDirection = 6;
export const readerContinuousBufferMaxSegmentsPerDirection = 480;

const readerContinuousBufferScreens: Record<
  ReaderContinuousBufferDirection,
  number
> = {
  previous: 1.5,
  next: 2.5,
};
export const getReaderContinuousBufferTarget = (
  viewportHeight: number,
  direction: ReaderContinuousBufferDirection,
) => Math.max(1, viewportHeight) * readerContinuousBufferScreens[direction];

export interface ReaderContinuousBufferState {
  renderedHeight: number;
  targetHeight: number;
  chapterCount: number;
  segmentCount: number;
  currentChapterRemainingSegments: number;
  hasAdjacentChapter: boolean;
}

export type ReaderContinuousBufferStopReason =
  'filled' | 'book-boundary' | 'chapter-limit' | 'segment-limit';

export type ReaderContinuousBufferDecision =
  | { kind: 'expand-segments'; count: number }
  | { kind: 'load-chapter' }
  | { kind: 'stop'; reason: ReaderContinuousBufferStopReason };

export const planReaderContinuousBuffer = (
  state: ReaderContinuousBufferState,
): ReaderContinuousBufferDecision => {
  if (state.renderedHeight >= state.targetHeight) {
    return { kind: 'stop', reason: 'filled' };
  }

  const remainingSegmentBudget =
    readerContinuousBufferMaxSegmentsPerDirection - state.segmentCount;
  if (remainingSegmentBudget <= 0) {
    return { kind: 'stop', reason: 'segment-limit' };
  }

  if (state.currentChapterRemainingSegments > 0) {
    return {
      kind: 'expand-segments',
      count: Math.min(
        readerContinuousBufferSegmentBatchSize,
        state.currentChapterRemainingSegments,
        remainingSegmentBudget,
      ),
    };
  }

  if (!state.hasAdjacentChapter) {
    return { kind: 'stop', reason: 'book-boundary' };
  }
  if (state.chapterCount >= readerContinuousBufferMaxChaptersPerDirection) {
    return { kind: 'stop', reason: 'chapter-limit' };
  }
  return { kind: 'load-chapter' };
};
