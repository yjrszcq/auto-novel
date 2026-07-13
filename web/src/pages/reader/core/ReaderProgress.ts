import type { ReaderProgress, ReaderSegment } from '@/model/Reader';

export const resolveProgressSegment = (
  segments: ReaderSegment[],
  progress: ReaderProgress | undefined,
) => {
  if (progress?.segmentId === undefined) {
    return undefined;
  }
  return segments.find((segment) => segment.id === progress.segmentId);
};

export const createReaderProgress = ({
  bookId,
  chapterId,
  segmentId,
  scrollRatio,
}: {
  bookId: string;
  chapterId: string;
  segmentId?: string;
  scrollRatio: number;
}): ReaderProgress => ({
  bookId,
  chapterId,
  segmentId,
  segmentOffset: 0,
  scrollRatio: Math.max(0, Math.min(scrollRatio, 1)),
  mode: 'original',
  updatedAt: Date.now(),
});
