import type {
  ReaderBook,
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderContentAdapter,
  ReaderNavigationEntry,
} from '@/model/Reader';

export type ReaderPageLoadResult =
  | {
      kind: 'ready';
      book: ReaderBook;
      chapters: ReaderChapterSummary[];
      navigation: ReaderNavigationEntry[];
      chapter: ReaderChapterContent;
    }
  | { kind: 'error'; message: string }
  | { kind: 'stale' };

const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : '无法加载阅读内容';

export const createReaderPageController = (adapter: ReaderContentAdapter) => {
  let requestId = 0;

  const cancel = () => {
    requestId += 1;
  };

  const load = async (
    bookId: string,
    requestedChapterId?: string,
  ): Promise<ReaderPageLoadResult> => {
    const currentRequest = ++requestId;
    try {
      const [book, chapters, nativeNavigation] = await Promise.all([
        adapter.getBook(bookId),
        adapter.getChapters(bookId),
        adapter.getNavigation?.(bookId) ?? Promise.resolve(undefined),
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
      [
        chapters[chapterSummary.index - 1],
        chapters[chapterSummary.index + 1],
      ].forEach((neighbor) => {
        if (neighbor !== undefined) {
          adapter.preloadChapter?.({ bookId, chapterId: neighbor.id });
        }
      });
      const navigation =
        nativeNavigation ??
        chapters.map(({ id, title }) => ({
          id,
          title,
          level: 0,
          chapterId: id,
        }));
      return { kind: 'ready', book, chapters, navigation, chapter };
    } catch (reason) {
      if (currentRequest !== requestId) {
        return { kind: 'stale' };
      }
      return { kind: 'error', message: errorMessage(reason) };
    }
  };

  return { load, cancel };
};
