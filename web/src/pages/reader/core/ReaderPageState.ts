import type {
  ReaderBook,
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderContentAdapter,
} from '@/model/Reader';

export type ReaderPageLoadResult =
  | {
      kind: 'ready';
      book: ReaderBook;
      chapters: ReaderChapterSummary[];
      chapter: ReaderChapterContent;
    }
  | { kind: 'error'; message: string }
  | { kind: 'stale' };

const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : '无法加载阅读内容';

export const createReaderPageController = (adapter: ReaderContentAdapter) => {
  let requestId = 0;

  const load = async (
    bookId: string,
    requestedChapterId?: string,
  ): Promise<ReaderPageLoadResult> => {
    const currentRequest = ++requestId;
    try {
      const [book, chapters] = await Promise.all([
        adapter.getBook(bookId),
        adapter.getChapters(bookId),
      ]);
      if (currentRequest !== requestId) {
        return { kind: 'stale' };
      }
      const chapterSummary =
        requestedChapterId === undefined
          ? chapters[0]
          : chapters.find((chapter) => chapter.id === requestedChapterId);
      if (chapterSummary === undefined) {
        return {
          kind: 'error',
          message:
            requestedChapterId === undefined
              ? '书籍没有可阅读章节'
              : '章节不存在',
        };
      }

      const chapter = await adapter.getChapter({
        bookId,
        chapterId: chapterSummary.id,
      });
      if (currentRequest !== requestId) {
        return { kind: 'stale' };
      }
      return { kind: 'ready', book, chapters, chapter };
    } catch (reason) {
      if (currentRequest !== requestId) {
        return { kind: 'stale' };
      }
      return { kind: 'error', message: errorMessage(reason) };
    }
  };

  return { load };
};
