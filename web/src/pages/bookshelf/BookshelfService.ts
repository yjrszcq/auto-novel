import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import type { ReaderBookshelfState, ReaderProgress } from '@/model/Reader';
import type { useLocalVolumeStore } from '@/stores';

export type BookshelfRepository = Pick<
  Awaited<ReturnType<typeof useLocalVolumeStore>>,
  | 'listVolume'
  | 'getVolume'
  | 'getReaderBookshelf'
  | 'getReaderProgress'
  | 'listReaderBookshelves'
  | 'putReaderBookshelf'
>;

export interface BookshelfEntry {
  volume: LocalVolumeMetadata;
  state: ReaderBookshelfState;
  progress?: ReaderProgress;
}

const createInitialState = (
  volume: LocalVolumeMetadata,
  updatedAt: number,
): ReaderBookshelfState => ({
  bookId: volume.id,
  listed: true,
  pinned: false,
  addedAt: volume.createAt,
  updatedAt,
});

export const createBookshelfService = (
  repository: BookshelfRepository,
  now: () => number = Date.now,
) => {
  const ensureBook = async (bookId: string) => {
    const volume = await repository.getVolume(bookId);
    if (volume === undefined) {
      throw new Error('书籍不存在');
    }
    return volume;
  };

  const ensureIndex = async (): Promise<BookshelfEntry[]> => {
    const [volumes, persistedStates] = await Promise.all([
      repository.listVolume(),
      repository.listReaderBookshelves(),
    ]);
    const states = new Map(
      persistedStates.map((state) => [state.bookId, state]),
    );
    const updatedAt = now();
    const createdStates = volumes
      .filter((volume) => !states.has(volume.id))
      .map((volume) => createInitialState(volume, updatedAt));

    await Promise.all(
      createdStates.map((state) => repository.putReaderBookshelf(state)),
    );
    createdStates.forEach((state) => states.set(state.bookId, state));

    return volumes.map((volume) => ({
      volume,
      state: states.get(volume.id)!,
    }));
  };

  const list = async () => {
    const entries = (await ensureIndex()).filter((entry) => entry.state.listed);
    return Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        progress: await repository.getReaderProgress(entry.volume.id),
      })),
    );
  };

  const setListed = async (bookId: string, listed: boolean) => {
    const volume = await ensureBook(bookId);
    const current = await repository.getReaderBookshelf(bookId);
    const updatedAt = now();
    const state: ReaderBookshelfState = {
      ...(current ?? createInitialState(volume, updatedAt)),
      bookId,
      listed,
      addedAt:
        listed && current?.listed === false
          ? updatedAt
          : current?.addedAt ?? volume.createAt,
      updatedAt,
    };
    await repository.putReaderBookshelf(state);
    return state;
  };

  const setPinned = async (bookId: string, pinned: boolean) => {
    const volume = await ensureBook(bookId);
    const current = await repository.getReaderBookshelf(bookId);
    const updatedAt = now();
    const state: ReaderBookshelfState = {
      ...(current ?? createInitialState(volume, updatedAt)),
      bookId,
      pinned,
      updatedAt,
    };
    await repository.putReaderBookshelf(state);
    return state;
  };

  return {
    ensureIndex,
    list,
    setListed,
    setPinned,
  };
};
