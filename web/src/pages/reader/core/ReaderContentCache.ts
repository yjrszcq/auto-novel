import type {
  GetReaderChapterInput,
  ReaderChapterContent,
  ReaderContentAdapter,
} from '@/model/Reader';

export interface CachedReaderContentAdapter extends ReaderContentAdapter {
  preloadChapter(input: GetReaderChapterInput): void;
  invalidateChapter(input: GetReaderChapterInput): void;
}

const createKey = ({ bookId, chapterId }: GetReaderChapterInput) =>
  `${bookId}/${chapterId}`;

const touch = <Value>(
  values: Map<string, Value>,
  key: string,
  value: Value,
) => {
  values.delete(key);
  values.set(key, value);
};

export const createCachedReaderContentAdapter = (
  adapter: ReaderContentAdapter,
  maxEntries = 6,
): CachedReaderContentAdapter => {
  const entries = new Map<string, Promise<ReaderChapterContent>>();
  const capacity = Math.max(1, maxEntries);

  const getChapter = (input: GetReaderChapterInput) => {
    const key = createKey(input);
    const cached = entries.get(key);
    if (cached !== undefined) {
      touch(entries, key, cached);
      return cached;
    }

    const loaded = adapter.getChapter(input).catch((reason: unknown) => {
      entries.delete(key);
      throw reason;
    });
    touch(entries, key, loaded);
    while (entries.size > capacity) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      entries.delete(oldestKey);
    }
    return loaded;
  };

  return {
    ...adapter,
    getChapter,
    preloadChapter(input) {
      void getChapter(input).catch(() => undefined);
    },
    invalidateChapter(input) {
      entries.delete(createKey(input));
    },
  };
};
