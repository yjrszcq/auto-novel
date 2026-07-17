import type { ReaderAnnotation } from '@/model/Reader';
import { createId } from '@/util/id';

export interface CreateReaderAnnotationInput extends Omit<
  ReaderAnnotation,
  'id' | 'createdAt' | 'updatedAt'
> {
  id?: string;
  now?: number;
}

export const createReaderAnnotation = ({
  id = createId(),
  now = Date.now(),
  ...input
}: CreateReaderAnnotationInput): ReaderAnnotation => ({
  id,
  ...input,
  createdAt: now,
  updatedAt: now,
});

export const resolveAnnotationRange = (
  annotation: ReaderAnnotation,
  text: string,
): { startOffset: number; endOffset: number } | undefined => {
  const { startOffset, endOffset, quote } = annotation;
  if (
    startOffset >= 0 &&
    endOffset >= startOffset &&
    text.slice(startOffset, endOffset) === quote
  ) {
    return { startOffset, endOffset };
  }
  const fallbackStart = text.indexOf(quote);
  return fallbackStart < 0
    ? undefined
    : { startOffset: fallbackStart, endOffset: fallbackStart + quote.length };
};

export interface ReaderTextFragment {
  text: string;
  style?: ReaderAnnotation['style'];
}

export const getAnnotationFragments = (
  text: string,
  annotations: ReaderAnnotation[],
): ReaderTextFragment[] => {
  const ranges = annotations
    .map((annotation) => ({
      annotation,
      range: resolveAnnotationRange(annotation, text),
    }))
    .filter(
      (
        item,
      ): item is {
        annotation: ReaderAnnotation;
        range: NonNullable<typeof item.range>;
      } => item.range !== undefined,
    )
    .sort((left, right) => left.range.startOffset - right.range.startOffset);
  const fragments: ReaderTextFragment[] = [];
  let cursor = 0;
  for (const { annotation, range } of ranges) {
    if (range.startOffset < cursor) {
      continue;
    }
    if (range.startOffset > cursor) {
      fragments.push({ text: text.slice(cursor, range.startOffset) });
    }
    fragments.push({
      text: text.slice(range.startOffset, range.endOffset),
      style: annotation.style,
    });
    cursor = range.endOffset;
  }
  if (cursor < text.length || fragments.length === 0) {
    fragments.push({ text: text.slice(cursor) });
  }
  return fragments;
};
