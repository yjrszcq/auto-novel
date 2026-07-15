import 'fake-indexeddb/auto';

import { deleteDB, openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';

const databaseName = 'reader-storage-migration-test';

afterEach(async () => {
  await deleteDB(databaseName);
});

describe('reader storage migration', () => {
  it('adds stable segment IDs and removes reader records with the volume', async () => {
    const legacy = await openDB(databaseName, 2, {
      upgrade(db) {
        db.createObjectStore('metadata', { keyPath: 'id' });
        db.createObjectStore('file', { keyPath: 'id' });
        const chapter = db.createObjectStore('chapter', { keyPath: 'id' });
        chapter.createIndex('byVolumeId', 'volumeId');
      },
    });
    await legacy.put('metadata', {
      id: 'book',
      createAt: 1,
      toc: [{ chapterId: '0' }],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
    });
    await legacy.put('chapter', {
      id: 'book/0',
      volumeId: 'book',
      paragraphs: ['first', 'second'],
    });
    legacy.close();

    const dao = await createLocalVolumeDao(databaseName);
    const chapter = await dao.getChapter('book', '0');

    expect(chapter?.paragraphs).toEqual(['first', 'second']);
    expect(chapter?.segmentIds).toHaveLength(2);
    expect(new Set(chapter?.segmentIds).size).toBe(2);

    const initialSegmentIds = chapter!.segmentIds;
    dao.close();

    const reopened = await createLocalVolumeDao(databaseName);
    expect((await reopened.getChapter('book', '0'))?.segmentIds).toEqual(
      initialSegmentIds,
    );

    await reopened.putReaderBookshelf({
      bookId: 'book',
      listed: true,
      pinned: false,
      addedAt: 1,
      updatedAt: 1,
    });
    await reopened.putReaderProgress({
      bookId: 'book',
      chapterId: '0',
      segmentId: initialSegmentIds[0],
      updatedAt: 1,
    });
    await reopened.putReaderBookmark({
      id: 'bookmark',
      bookId: 'book',
      chapterId: '0',
      segmentId: initialSegmentIds[0],
      createdAt: 1,
    });
    expect(await reopened.listReaderBookmarks('book')).toHaveLength(1);
    await reopened.deleteReaderBookmark('bookmark');
    expect(await reopened.listReaderBookmarks('book')).toEqual([]);
    await reopened.putReaderBookmark({
      id: 'bookmark',
      bookId: 'book',
      chapterId: '0',
      segmentId: initialSegmentIds[0],
      createdAt: 1,
    });

    const cover = new Blob(['cover'], { type: 'image/png' });
    await reopened.putReaderCover({
      bookId: 'book',
      blob: cover,
      updatedAt: 1,
    });
    expect(await reopened.getReaderCover('book')).toMatchObject({
      bookId: 'book',
    });
    await reopened.deleteReaderCover('book');
    expect(await reopened.getReaderCover('book')).toBeUndefined();
    await reopened.putReaderCover({
      bookId: 'book',
      blob: cover,
      updatedAt: 1,
    });

    await reopened.putReaderAnnotation({
      id: 'annotation',
      bookId: 'book',
      chapterId: '0',
      segmentId: initialSegmentIds[0],
      languageSide: 'original',
      startOffset: 0,
      endOffset: 5,
      quote: 'first',
      style: 'highlight',
      createdAt: 1,
      updatedAt: 1,
    });
    await reopened.putReaderChapterCache({
      key: 'book/0/current',
      bookId: 'book',
      chapterId: '0',
      contentRevision: 'current',
      cachedAt: 1,
    });

    await reopened.deleteReaderDataByVolumeId('book');

    expect(await reopened.getReaderBookshelf('book')).toBeUndefined();
    expect(await reopened.getReaderProgress('book')).toBeUndefined();
    expect(await reopened.listReaderBookmarks('book')).toEqual([]);
    expect(await reopened.getReaderCover('book')).toBeUndefined();
    expect(await reopened.listReaderAnnotations('book')).toEqual([]);
    reopened.close();
  });
});
