export interface ReaderSegmentRange {
  start: number;
  end: number;
}

const longChapterThreshold = 1_000;
export const readerSegmentBatchSize = 240;
export const readerSegmentWindowSize = readerSegmentBatchSize * 2;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export const getInitialSegmentRange = (
  total: number,
  anchorIndex = -1,
): ReaderSegmentRange => {
  if (total <= longChapterThreshold) {
    return { start: 0, end: total };
  }
  if (anchorIndex < 0) {
    return { start: 0, end: Math.min(total, readerSegmentBatchSize) };
  }
  const start = clamp(
    anchorIndex - Math.floor(readerSegmentBatchSize / 2),
    0,
    Math.max(0, total - readerSegmentBatchSize),
  );
  return {
    start,
    end: Math.min(total, start + readerSegmentBatchSize),
  };
};

export const expandSegmentRange = (
  range: ReaderSegmentRange,
  total: number,
  direction: 'before' | 'after',
): ReaderSegmentRange => {
  if (direction === 'before') {
    const start = Math.max(0, range.start - readerSegmentBatchSize);
    return { start, end: Math.min(range.end, start + readerSegmentWindowSize) };
  }
  const end = Math.min(total, range.end + readerSegmentBatchSize);
  return { start: Math.max(range.start, end - readerSegmentWindowSize), end };
};
