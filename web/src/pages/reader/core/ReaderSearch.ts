import type { ReaderChapterContent } from '@/model/Reader';

export interface ReaderSearchResult {
  chapterId: string;
  chapterTitle: string;
  segmentId: string;
  languageSide: 'original' | 'translated';
  excerpt: string;
}
export const readerSearchResultLimit = 200;

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
  maximumResults = readerSearchResultLimit,
): ReaderSearchResult[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }
  const results: ReaderSearchResult[] = [];
  const limit = Math.max(0, Math.floor(maximumResults));
  if (limit === 0) return results;
  for (const chapter of chapters) {
    for (const segment of chapter.segments) {
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
      for (const { languageSide, text } of candidates) {
        const index = text.toLocaleLowerCase().indexOf(normalizedQuery);
        if (index < 0) continue;
        results.push({
          chapterId: chapter.chapterId,
          chapterTitle: chapter.title,
          segmentId: segment.id,
          languageSide,
          excerpt: createExcerpt(text, index, normalizedQuery.length),
        });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
};
