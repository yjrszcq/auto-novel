import { describe, expect, it } from 'vitest';

import type { LocalVolumeMetadata } from '../src/model/LocalVolume';
import type { ReaderBookshelfState } from '../src/model/Reader';
import {
  createBookshelfService,
  type BookshelfRepository,
} from '../src/pages/bookshelf/BookshelfService';

const volumes: LocalVolumeMetadata[] = [
  {
    id: 'book-a.epub',
    createAt: 10,
    toc: [],
    glossaryId: 'a',
    glossary: {},
    favoredId: 'default',
  },
  {
    id: 'book-b.epub',
    createAt: 20,
    toc: [],
    glossaryId: 'b',
    glossary: {},
    favoredId: 'default',
  },
];

const createRepository = (states: ReaderBookshelfState[]) => {
  const records = new Map(states.map((state) => [state.bookId, state]));
  const writes: ReaderBookshelfState[] = [];
  const repository: BookshelfRepository = {
    listVolume: async () => volumes,
    getVolume: async (bookId) => volumes.find((volume) => volume.id === bookId),
    getReaderBookshelf: async (bookId) => records.get(bookId),
    getReaderProgress: async () => undefined,
    listReaderBookshelves: async () => [...records.values()],
    putReaderBookshelf: async (state) => {
      writes.push(state);
      records.set(state.bookId, state);
      return state.bookId;
    },
  };
  return { repository, records, writes };
};

describe('bookshelf state service', () => {
  it('indexes and lists every local volume', async () => {
    const { repository, records, writes } = createRepository([
      {
        bookId: 'book-b.epub',
        pinned: false,
        addedAt: 21,
        updatedAt: 22,
      },
    ]);
    const service = createBookshelfService(repository, () => 100);

    await expect(service.list()).resolves.toMatchObject([
      {
        volume: { id: 'book-a.epub' },
        state: {
          bookId: 'book-a.epub',
          addedAt: 10,
          updatedAt: 100,
        },
      },
      {
        volume: { id: 'book-b.epub' },
        state: {
          bookId: 'book-b.epub',
          pinned: false,
        },
      },
    ]);
    expect(records.get('book-b.epub')?.pinned).toBe(false);
    expect(writes).toHaveLength(1);

    await service.list();

    expect(writes).toHaveLength(1);
  });

  it('persists pinning without changing the local book collection', async () => {
    const { repository, records } = createRepository([]);
    let timestamp = 100;
    const service = createBookshelfService(repository, () => timestamp++);

    await service.ensureIndex();
    await service.setPinned('book-a.epub', true);
    expect(records.get('book-a.epub')).toMatchObject({
      pinned: true,
      addedAt: 10,
    });
    expect(volumes.find((volume) => volume.id === 'book-a.epub')).toBeDefined();

    await service.setPinned('book-a.epub', false);
    expect(records.get('book-a.epub')).toMatchObject({
      pinned: false,
      addedAt: 10,
    });
  });
});
