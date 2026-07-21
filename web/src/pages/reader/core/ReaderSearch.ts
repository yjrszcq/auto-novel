import type {
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderContentAdapter,
} from '@/model/Reader';
import type { ReaderChineseScript } from '@/model/Reader';
import { readerChineseScriptService } from './ReaderChineseScript';

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

export const searchReaderChapters = async (
  chapters: ReaderChapterContent[],
  query: string,
  maximumResults = readerSearchResultLimit,
  options?: { bookId?: string; excerptScript?: ReaderChineseScript },
): Promise<ReaderSearchResult[]> => {
  const bookId = options?.bookId ?? chapters[0]?.bookId ?? 'reader-search';
  const normalizedQuery = (
    await readerChineseScriptService.convert({
      bookId,
      script: 'simplified',
      text: query.trim(),
    })
  ).toLocaleLowerCase();
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
        const normalizedText = (
          await readerChineseScriptService.convert({
            bookId,
            script: 'simplified',
            text,
          })
        ).toLocaleLowerCase();
        const index = normalizedText.indexOf(normalizedQuery);
        if (index < 0) continue;
        const excerpt = createExcerpt(text, index, normalizedQuery.length);
        results.push({
          chapterId: chapter.chapterId,
          chapterTitle: chapter.title,
          segmentId: segment.id,
          languageSide,
          excerpt: await readerChineseScriptService.convert({
            bookId,
            script: options?.excerptScript ?? 'none',
            text: excerpt,
          }),
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
    excerptScript?: ReaderChineseScript;
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
        ...(await searchReaderChapters(
          chapters,
          input.query,
          maximumResults - found.length,
          { bookId: input.bookId, excerptScript: input.excerptScript },
        )),
      );
      if (found.length >= maximumResults) {
        return { kind: 'results', results: found, truncated: true };
      }
    }
    return { kind: 'results', results: found, truncated: false };
  };

  return { search, cancel };
};
