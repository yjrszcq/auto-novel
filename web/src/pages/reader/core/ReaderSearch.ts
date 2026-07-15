import type { ReaderChapterContent } from '@/model/Reader';

export interface ReaderSearchResult {
  chapterId: string;
  chapterTitle: string;
  segmentId: string;
  languageSide: 'original' | 'translated';
  excerpt: string;
}

const createExcerpt = (text: string, index: number, queryLength: number) => {
  const start = Math.max(0, index - 28);
  const end = Math.min(text.length, index + queryLength + 48);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end) +
    (end < text.length ? '…' : '')
  );
};

export const searchReaderChapters = (
  chapters: ReaderChapterContent[],
  query: string,
): ReaderSearchResult[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }
  return chapters.flatMap((chapter) =>
    chapter.segments.flatMap((segment) => {
      const candidates: {
        languageSide: 'original' | 'translated';
        text: string;
      }[] = [
        { languageSide: 'original', text: segment.original },
        ...(segment.translated === undefined
          ? []
          : [
              { languageSide: 'translated' as const, text: segment.translated },
            ]),
      ];
      return candidates.flatMap(({ languageSide, text }) => {
        const index = text.toLocaleLowerCase().indexOf(normalizedQuery);
        return index < 0
          ? []
          : [
              {
                chapterId: chapter.chapterId,
                chapterTitle: chapter.title,
                segmentId: segment.id,
                languageSide,
                excerpt: createExcerpt(text, index, normalizedQuery.length),
              },
            ];
      });
    }),
  );
};
