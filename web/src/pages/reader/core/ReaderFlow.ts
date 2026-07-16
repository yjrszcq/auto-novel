import type { ReaderFlow } from '@/model/Reader';

export type ResolvedReaderFlow = Exclude<ReaderFlow, 'auto'>;

export const resolveReaderFlow = (
  flow: ReaderFlow | undefined,
  desktop: boolean,
): ResolvedReaderFlow => {
  if (flow === 'paginated' || flow === 'scrolled') return flow;
  return desktop ? 'paginated' : 'scrolled';
};

export const getReaderPageMetrics = ({
  clientWidth,
  scrollLeft,
  scrollWidth,
}: {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
}) => {
  const pageWidth = Math.max(1, clientWidth);
  const pageCount = Math.max(1, Math.ceil(scrollWidth / pageWidth));
  const scrollable = Math.max(0, scrollWidth - clientWidth);
  const pageIndex =
    scrollable > 0 && scrollLeft >= scrollable - 1
      ? pageCount - 1
      : Math.max(
          0,
          Math.min(pageCount - 1, Math.round(scrollLeft / pageWidth)),
        );
  const ratio =
    scrollable === 0 ? 0 : Math.max(0, Math.min(1, scrollLeft / scrollable));
  return { pageCount, pageIndex, pageWidth, ratio };
};

export const getReaderPageDelta = (key: string) => {
  if (key === 'ArrowLeft' || key === 'PageUp') return -1;
  if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') return 1;
  return 0;
};

export type ReaderPageTurn =
  | { kind: 'page'; pageIndex: number }
  | { kind: 'segments'; direction: 'previous' | 'next' }
  | { kind: 'chapter'; direction: 'previous' | 'next' }
  | { kind: 'none' };

export const resolveReaderPageTurn = ({
  pageIndex,
  pageCount,
  delta,
  hasPreviousSegments,
  hasMoreSegments,
  hasPreviousChapter,
  hasNextChapter,
}: {
  pageIndex: number;
  pageCount: number;
  delta: number;
  hasPreviousSegments: boolean;
  hasMoreSegments: boolean;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;
}): ReaderPageTurn => {
  if (delta === 0) return { kind: 'none' };
  const targetPage = pageIndex + Math.sign(delta);
  if (targetPage >= 0 && targetPage < pageCount) {
    return { kind: 'page', pageIndex: targetPage };
  }
  if (delta < 0) {
    if (hasPreviousSegments) {
      return { kind: 'segments', direction: 'previous' };
    }
    return hasPreviousChapter
      ? { kind: 'chapter', direction: 'previous' }
      : { kind: 'none' };
  }
  if (hasMoreSegments) {
    return { kind: 'segments', direction: 'next' };
  }
  return hasNextChapter
    ? { kind: 'chapter', direction: 'next' }
    : { kind: 'none' };
};

export const resolveReaderBoundaryGesture = ({
  startY,
  endY,
  startedAtStart,
  startedAtEnd,
  minimumDistance = 56,
}: {
  startY: number;
  endY: number;
  startedAtStart: boolean;
  startedAtEnd: boolean;
  minimumDistance?: number;
}): 'previous' | 'next' | undefined => {
  const distance = endY - startY;
  if (startedAtEnd && distance <= -minimumDistance) return 'next';
  if (startedAtStart && distance >= minimumDistance) return 'previous';
  return undefined;
};
