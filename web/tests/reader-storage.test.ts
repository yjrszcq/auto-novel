import 'fake-indexeddb/auto';

import { deleteDB, openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';

const databaseName = 'reader-storage-test';

afterEach(async () => {
  await deleteDB(databaseName);
});

describe('reader storage', () => {
  it('creates book indexes for reader-owned records', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    dao.close();

    const db = await openDB(databaseName, 5);
    const tx = db.transaction(
      ['reader-bookmark', 'reader-annotation', 'reader-chapter-cache'],
      'readonly',
    );

    expect(
      tx.objectStore('reader-bookmark').indexNames.contains('byBookId'),
    ).toBe(true);
    expect(
      tx.objectStore('reader-annotation').indexNames.contains('byBookId'),
    ).toBe(true);
    expect(
      tx.objectStore('reader-chapter-cache').indexNames.contains('byBookId'),
    ).toBe(true);
    await tx.done;
    db.close();
  });

  it('saves presentation metadata and its selected cover atomically', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    await dao.createMetadata({
      id: 'book',
      createAt: 1,
      toc: [],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
    });
    const cover = new Blob(['custom-cover'], { type: 'image/png' });

    await dao.updateBookPresentation({
      id: 'book',
      bookMetadata: { title: '展示标题', coverUrl: '' },
      downloadMetadataPreference: {
        original: 'source',
        translated: 'embed',
      },
      cover: {
        bookId: 'book',
        blob: cover,
        source: 'custom',
        updatedAt: 2,
      },
    });

    expect(await dao.getMetadata('book')).toMatchObject({
      bookMetadata: { title: '展示标题', coverUrl: '' },
    });
    expect(await dao.getReaderCover('book')).toMatchObject({
      bookId: 'book',
      source: 'custom',
    });

    await dao.updateBookPresentation({
      id: 'book',
      bookMetadata: {
        title: '链接封面',
        coverUrl: 'https://example.com/cover.jpg',
      },
      downloadMetadataPreference: {
        original: 'source',
        translated: 'embed',
      },
      cover: null,
    });

    expect(await dao.getReaderCover('book')).toBeUndefined();
    dao.close();
  });

  it('persists stable segment IDs and atomically removes the complete volume graph', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    await dao.createMetadata({
      id: 'book',
      createAt: 1,
      toc: [{ chapterId: '0' }],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
    });
    await dao.createChapter({
      id: 'book/0',
      volumeId: 'book',
      paragraphs: ['first', 'second'],
      segmentIds: ['segment-1', 'segment-2'],
    });
    const chapter = await dao.getChapter('book', '0');

    expect(chapter?.paragraphs).toEqual(['first', 'second']);
    expect(chapter?.segmentIds).toEqual(['segment-1', 'segment-2']);

    const initialSegmentIds = chapter!.segmentIds;
    dao.close();

    const reopened = await createLocalVolumeDao(databaseName);
    expect((await reopened.getChapter('book', '0'))?.segmentIds).toEqual(
      initialSegmentIds,
    );
    await reopened.createFile(
      'book',
      new File(['source'], 'book.txt', { type: 'text/plain' }),
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
    await reopened.putReaderReadingStats({
      bookId: 'book',
      totalReadingMs: 60_000,
      lastReadAt: 1,
    });
    expect(await reopened.getReaderReadingStats('book')).toMatchObject({
      totalReadingMs: 60_000,
    });

    await reopened.putReaderBookmark({
      id: 'bookmark',
      bookId: 'book',
      chapterId: '0',
      segmentId: initialSegmentIds[0],
      createdAt: 1,
    });
    await reopened.putReaderBookmark({
      id: 'other-bookmark',
      bookId: 'other-book',
      chapterId: '0',
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
    await reopened.putReaderAnnotation({
      id: 'other-annotation',
      bookId: 'other-book',
      chapterId: '0',
      segmentId: 'other-segment',
      languageSide: 'original',
      startOffset: 0,
      endOffset: 1,
      quote: 'other',
      style: 'highlight',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await reopened.listReaderAnnotations('book')).toHaveLength(1);
    await reopened.deleteReaderAnnotation('annotation');
    expect(await reopened.listReaderAnnotations('book')).toEqual([]);
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
    await reopened.putReaderChapterCache({
      key: 'other-book/0/current',
      bookId: 'other-book',
      chapterId: '0',
      contentRevision: 'current',
      cachedAt: 1,
    });

    await reopened.putReaderSettings({
      id: 'default',
      defaultMode: 'original-translated',
      translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
      fontSize: 18,
      lineHeight: 1.8,
      contentWidth: 900,
      horizontalPadding: 24,
      theme: 'system',
      flow: 'auto',
      updatedAt: 1,
    });
    await reopened.deleteVolume('book');

    expect(await reopened.getMetadata('book')).toBeUndefined();
    expect(await reopened.getFile('book')).toBeUndefined();
    expect(await reopened.getChapter('book', '0')).toBeUndefined();
    expect(await reopened.getReaderBookshelf('book')).toBeUndefined();
    expect(await reopened.getReaderProgress('book')).toBeUndefined();
    expect(await reopened.getReaderReadingStats('book')).toBeUndefined();
    expect(await reopened.listReaderBookmarks('book')).toEqual([]);
    expect(await reopened.getReaderCover('book')).toBeUndefined();
    expect(await reopened.listReaderAnnotations('book')).toEqual([]);
    expect(await reopened.listReaderBookmarks('other-book')).toHaveLength(1);
    expect(await reopened.listReaderAnnotations('other-book')).toHaveLength(1);
    expect(await reopened.listReaderChapterCaches('other-book')).toHaveLength(
      1,
    );
    reopened.close();

    const settingsReloaded = await createLocalVolumeDao(databaseName);
    expect(await settingsReloaded.getReaderSettings()).toMatchObject({
      defaultMode: 'original-translated',
    });
    settingsReloaded.close();
  });
});
