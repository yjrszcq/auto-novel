import type {
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderContentAdapter,
} from '@/model/Reader';

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

export type ReaderSearchResponse =
  | { kind: 'stale' }
  | { kind: 'results'; results: ReaderSearchResult[]; truncated: boolean };

export const createReaderSearchController = (
  adapter: ReaderContentAdapter,
  options?: { batchSize?: number; maximumResults?: number },
) => {
  const batchSize = Math.max(1, Math.floor(options?.batchSize ?? 12));
  const maximumResults = Math.max(
    1,
    Math.floor(options?.maximumResults ?? readerSearchResultLimit),
  );
  let requestId = 0;

  const cancel = () => {
    requestId += 1;
  };

  const search = async (input: {
    bookId: string;
    chapters: ReaderChapterSummary[];
    query: string;
  }): Promise<ReaderSearchResponse> => {
    const currentRequest = ++requestId;
    const found: ReaderSearchResult[] = [];
    for (let index = 0; index < input.chapters.length; index += batchSize) {
      const chapters = await Promise.all(
        input.chapters.slice(index, index + batchSize).map((chapter) =>
          adapter.getChapter({
            bookId: input.bookId,
            chapterId: chapter.id,
          }),
        ),
      );
      if (currentRequest !== requestId) return { kind: 'stale' };
      found.push(
        ...searchReaderChapters(
          chapters,
          input.query,
          maximumResults - found.length,
        ),
      );
      if (found.length >= maximumResults) {
        return { kind: 'results', results: found, truncated: true };
      }
    }
    return { kind: 'results', results: found, truncated: false };
  };

  return { search, cancel };
};
