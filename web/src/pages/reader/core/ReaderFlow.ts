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
  const pageIndex = Math.max(
    0,
    Math.min(pageCount - 1, Math.round(scrollLeft / pageWidth)),
  );
  const scrollable = Math.max(0, scrollWidth - clientWidth);
  const ratio =
    scrollable === 0 ? 0 : Math.max(0, Math.min(1, scrollLeft / scrollable));
  return { pageCount, pageIndex, pageWidth, ratio };
};

export const getReaderPageDelta = (key: string) => {
  if (key === 'ArrowLeft' || key === 'PageUp') return -1;
  if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') return 1;
  return 0;
};
