import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import type { NativeEpubMigrationCommit } from '../src/stores/local/LocalVolumeDao';
import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => deleteDB(name)));
});

const createLegacyBook = async (name: string) => {
  databaseNames.push(name);
  const dao = await createLocalVolumeDao(name);
  await dao.createMetadata({
    id: 'book.epub',
    createAt: 1,
    toc: [{ chapterId: 'old.xhtml' }],
    glossaryId: 'glossary',
    glossary: {},
    favoredId: 'default',
  });
  const oldChapter = {
    id: 'book.epub/old.xhtml',
    volumeId: 'book.epub',
    paragraphs: ['一', '二'],
    segmentIds: ['segment-1', 'segment-2'],
  };
  await dao.createChapter(oldChapter);
  return { dao, oldChapter };
};

const createCommit = (
  oldChapter: Awaited<ReturnType<typeof createLegacyBook>>['oldChapter'],
): NativeEpubMigrationCommit => ({
  bookId: 'book.epub',
  expectedChapters: [oldChapter],
  chapters: [
    {
      id: 'book.epub/new.xhtml',
      volumeId: 'book.epub',
      paragraphs: ['一', '二'],
      segmentIds: ['segment-1', 'segment-2'],
      sourceRanges: [{ href: 'Text/new.xhtml', start: 0, end: 2 }],
    },
  ],
  toc: [{ chapterId: 'new.xhtml', title: '新章节' }],
  navigation: [
    {
      id: 'nav-0',
      title: '新章节',
      level: 0,
      chapterId: 'new.xhtml',
    },
  ],
  chapterMap: { 'old.xhtml': 'new.xhtml' },
  segmentChapterMap: {
    'segment-1': 'new.xhtml',
    'segment-2': 'new.xhtml',
  },
});

describe('native EPUB migration storage transaction', () => {
  it('atomically remaps reader records and invalidates chapter caches', async () => {
    const { dao, oldChapter } = await createLegacyBook(
      'epub-migration-success',
    );
    await dao.putReaderProgress({
      bookId: 'book.epub',
      chapterId: 'old.xhtml',
      segmentId: 'segment-2',
      updatedAt: 1,
    });
    await dao.putReaderBookmark({
      id: 'bookmark',
      bookId: 'book.epub',
      chapterId: 'old.xhtml',
      segmentId: 'segment-1',
      createdAt: 1,
    });
    await dao.putReaderAnnotation({
      id: 'annotation',
      bookId: 'book.epub',
      chapterId: 'old.xhtml',
      segmentId: 'segment-2',
      languageSide: 'original',
      startOffset: 0,
      endOffset: 1,
      quote: '二',
      style: 'highlight',
      createdAt: 1,
      updatedAt: 1,
    });
    await dao.putReaderChapterCache({
      key: 'book.epub/old.xhtml/revision',
      bookId: 'book.epub',
      chapterId: 'old.xhtml',
      contentRevision: 'revision',
      cachedAt: 1,
    });

    await expect(dao.migrateNativeEpub(createCommit(oldChapter))).resolves.toBe(
      true,
    );
    expect(await dao.getChapter('book.epub', 'old.xhtml')).toBeUndefined();
    expect(await dao.getChapter('book.epub', 'new.xhtml')).toMatchObject({
      segmentIds: ['segment-1', 'segment-2'],
    });
    expect(await dao.getMetadata('book.epub')).toMatchObject({
      contentVersion: 2,
      sourceFormat: 'epub',
      toc: [{ chapterId: 'new.xhtml', title: '新章节' }],
    });
    expect(await dao.getReaderProgress('book.epub')).toMatchObject({
      chapterId: 'new.xhtml',
      segmentId: 'segment-2',
    });
    expect(await dao.listReaderBookmarks('book.epub')).toMatchObject([
      { chapterId: 'new.xhtml', segmentId: 'segment-1' },
    ]);
    expect(await dao.listReaderAnnotations('book.epub')).toMatchObject([
      { chapterId: 'new.xhtml', segmentId: 'segment-2' },
    ]);
    expect(await dao.listReaderChapterCaches('book.epub')).toEqual([]);
    dao.close();

    const reopened = await createLocalVolumeDao('epub-migration-success');
    await expect(
      reopened.migrateNativeEpub(createCommit(oldChapter)),
    ).resolves.toBe(false);
    expect(await reopened.getChapter('book.epub', 'new.xhtml')).toMatchObject({
      segmentIds: ['segment-1', 'segment-2'],
    });
    reopened.close();
  });

  it('writes nothing when a reader location cannot be mapped', async () => {
    const { dao, oldChapter } = await createLegacyBook(
      'epub-migration-failure',
    );
    await dao.putReaderBookmark({
      id: 'bookmark',
      bookId: 'book.epub',
      chapterId: 'old.xhtml',
      segmentId: 'missing-segment',
      createdAt: 1,
    });

    await expect(
      dao.migrateNativeEpub(createCommit(oldChapter)),
    ).rejects.toThrow('无法定位旧阅读段落');
    expect(await dao.getMetadata('book.epub')).not.toHaveProperty(
      'contentVersion',
    );
    expect(await dao.getChapter('book.epub', 'old.xhtml')).toEqual(oldChapter);
    expect(await dao.getChapter('book.epub', 'new.xhtml')).toBeUndefined();
    dao.close();
  });
});
