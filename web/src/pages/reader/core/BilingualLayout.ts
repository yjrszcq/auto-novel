import type { ReaderMode, ReaderSegment } from '@/model/Reader';

export type RenderedReaderMode = Exclude<ReaderMode, 'ask'>;

export const resolveRenderedReaderMode = (
  mode: ReaderMode,
  segments: ReaderSegment[],
): RenderedReaderMode => {
  if (mode === 'ask' || mode === 'original') {
    return 'original';
  }
  return segments.some((segment) => segment.translated?.trim())
    ? mode
    : 'original';
};

export const hasTranslation = (segment: ReaderSegment) =>
  Boolean(segment.translated?.trim());
