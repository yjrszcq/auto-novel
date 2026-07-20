import 'fake-indexeddb/auto';

import { deleteDB, openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { getChapterFormalTranslationRevision } from '../src/domain/translate/ChapterTranslationCompletion';

import {
  LOCAL_VOLUME_DATABASE_VERSION,
  createLocalVolumeDao,
} from '../src/stores/local/LocalVolumeDao';

const databaseName = 'reader-storage-test';

afterEach(async () => {
  await deleteDB(databaseName);
});

describe('reader storage', () => {
  it('resets incompatible application data on the current database version', async () => {
    const legacy = await openDB(
      databaseName,
      LOCAL_VOLUME_DATABASE_VERSION - 1,
      {
        upgrade(db) {
          db.createObjectStore('legacy', { keyPath: 'id' }).put({
            id: 'old-book',
          });
        },
      },
    );
    legacy.close();

    const dao = await createLocalVolumeDao(databaseName);
    expect(await dao.listMetadata()).toEqual([]);
    dao.close();

    const current = await openDB(databaseName);
    expect(current.version).toBe(LOCAL_VOLUME_DATABASE_VERSION);
    expect(current.objectStoreNames.contains('legacy')).toBe(false);
    expect(current.objectStoreNames.contains('metadata')).toBe(true);
    expect(current.objectStoreNames.contains('reader-annotation')).toBe(false);
    current.close();
  });

  it('creates book indexes for reader-owned records', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    dao.close();

    const db = await openDB(databaseName);
    const tx = db.transaction(
      ['reader-bookmark', 'reader-chapter-cache'],
      'readonly',
    );

    expect(
      tx.objectStore('reader-bookmark').indexNames.contains('byBookId'),
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

    await reopened.putReaderChapterCache({
      key: 'book/0/current',
      bookId: 'book',
      chapterId: '0',
      contentRevision: 'current',
      cachedAt: 1,
    });
    await reopened.upsertReaderAutomaticTranslationCache({
      kind: 'automatic-translation',
      key: 'book/0/automatic',
      bookId: 'book',
      chapterId: '0',
      source: 'gpt',
      purpose: 'automatic',
      selectionKey: 'selection',
      glossaryId: 'glossary',
      contentRevision: 'current',
      entries: [{ segmentId: initialSegmentIds[0]!, translated: '草稿' }],
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
      autoTranslationPreloadPages: 3,
      retranslationPolicy: 'ask',
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
    expect(await reopened.listReaderChapterCaches('book')).toEqual([]);
    expect(await reopened.listReaderBookmarks('other-book')).toHaveLength(1);
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

  it('updates a chapter translation and its TOC version in one transaction', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    await dao.createMetadata({
      id: 'book',
      createAt: 1,
      toc: [{ chapterId: '0' }],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceFormat: 'txt',
      sourceBookMetadata: {},
    });
    await dao.createChapter({
      id: 'book/0',
      volumeId: 'book',
      paragraphs: ['原文'],
      segmentIds: ['segment'],
    });
    await dao.upsertReaderAutomaticTranslationCache({
      kind: 'automatic-translation',
      key: 'draft-before-formal-translation',
      bookId: 'book',
      chapterId: '0',
      source: 'sakura',
      purpose: 'automatic',
      selectionKey: 'selection',
      glossaryId: 'glossary',
      contentRevision: 'revision',
      entries: [{ segmentId: 'segment', translated: '草稿' }],
      cachedAt: 1,
    });

    await dao.putChapterTranslation({
      bookId: 'book',
      chapterId: '0',
      translatorId: 'gpt',
      translation: {
        glossaryId: 'translated',
        glossary: {},
        paragraphs: ['译文'],
      },
    });
    expect((await dao.getChapter('book', '0'))?.gpt?.paragraphs).toEqual([
      '译文',
    ]);
    expect((await dao.getMetadata('book'))?.toc[0]?.gpt).toBe('translated');
    expect(await dao.listReaderAutomaticTranslationCaches('book')).toEqual([]);
    const translatedChapter = await dao.getChapter('book', '0');
    expect(translatedChapter).toBeDefined();
    expect(
      await dao.upsertReaderAutomaticTranslationCache({
        kind: 'automatic-translation',
        key: 'late-draft',
        bookId: 'book',
        chapterId: '0',
        source: 'sakura',
        purpose: 'automatic',
        selectionKey: 'selection',
        glossaryId: 'glossary',
        contentRevision: 'revision',
        entries: [{ segmentId: 'segment', translated: '迟到草稿' }],
        cachedAt: 2,
      }),
    ).toBeUndefined();
    expect(await dao.listReaderAutomaticTranslationCaches('book')).toEqual([]);

    expect(
      await dao.upsertReaderAutomaticTranslationCache({
        kind: 'automatic-translation',
        key: 'retranslation-draft',
        bookId: 'book',
        chapterId: '0',
        source: 'gpt',
        purpose: 'retranslate',
        selectionKey: 'selection',
        glossaryId: 'glossary',
        contentRevision: 'revision',
        formalTranslationRevision: getChapterFormalTranslationRevision(
          translatedChapter!,
        ),
        entries: [{ segmentId: 'segment', translated: '候选译文' }],
        cachedAt: 3,
      }),
    ).toMatchObject({ key: 'retranslation-draft' });
    expect(await dao.listReaderAutomaticTranslationCaches('book')).toHaveLength(
      1,
    );

    await expect(
      dao.putChapterTranslation({
        bookId: 'book',
        chapterId: '0',
        translatorId: 'sakura',
        translation: {
          glossaryId: 'invalid',
          glossary: {},
          paragraphs: [],
        },
      }),
    ).rejects.toThrow('翻译段落数量与原文不一致');
    expect((await dao.getChapter('book', '0'))?.sakura).toBeUndefined();
    expect((await dao.getMetadata('book'))?.toc[0]?.sakura).toBeUndefined();

    await dao.putChapterTranslation({
      bookId: 'book',
      chapterId: '0',
      translatorId: 'gpt',
      translation: {
        glossaryId: 'replacement',
        glossary: {},
        paragraphs: ['替换译文'],
      },
    });
    expect(await dao.listReaderAutomaticTranslationCaches('book')).toEqual([]);
    expect(
      await dao.upsertReaderAutomaticTranslationCache({
        kind: 'automatic-translation',
        key: 'late-retranslation-draft',
        bookId: 'book',
        chapterId: '0',
        source: 'gpt',
        purpose: 'retranslate',
        selectionKey: 'selection',
        glossaryId: 'glossary',
        contentRevision: 'revision',
        formalTranslationRevision: getChapterFormalTranslationRevision(
          translatedChapter!,
        ),
        entries: [{ segmentId: 'segment', translated: '迟到候选' }],
        cachedAt: 4,
      }),
    ).toBeUndefined();
    expect(await dao.listReaderAutomaticTranslationCaches('book')).toEqual([]);

    await dao.createChapter({
      id: 'orphan/0',
      volumeId: 'orphan',
      paragraphs: ['不能提交'],
      segmentIds: ['orphan-segment'],
    });
    await expect(
      dao.putChapterTranslation({
        bookId: 'orphan',
        chapterId: '0',
        translatorId: 'gpt',
        translation: {
          glossaryId: 'should-not-write',
          glossary: {},
          paragraphs: ['错误译文'],
        },
      }),
    ).rejects.toThrow('小说不存在');
    expect((await dao.getChapter('orphan', '0'))?.gpt).toBeUndefined();
    dao.close();
  });

  it('persists and merges reader automatic translation drafts without changing the schema version', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const base = {
      kind: 'automatic-translation' as const,
      key: 'auto:book\u0000chapter\u0000gpt',
      bookId: 'book',
      chapterId: 'chapter',
      source: 'gpt' as const,
      purpose: 'automatic' as const,
      selectionKey: 'safe-selection-digest',
      glossaryId: 'glossary',
      contentRevision: 'revision',
    };

    await dao.upsertReaderAutomaticTranslationCache({
      ...base,
      entries: [{ segmentId: 'one', translated: '译文一' }],
      cachedAt: 1,
    });
    await dao.upsertReaderAutomaticTranslationCache({
      ...base,
      entries: [
        { segmentId: 'one', translated: '更新译文一' },
        { segmentId: 'two', translated: '译文二' },
      ],
      cachedAt: 2,
    });

    expect(await dao.getReaderAutomaticTranslationCache(base.key)).toEqual({
      ...base,
      entries: [
        { segmentId: 'one', translated: '更新译文一' },
        { segmentId: 'two', translated: '译文二' },
      ],
      cachedAt: 2,
    });
    dao.close();

    const reopened = await createLocalVolumeDao(databaseName);
    expect(
      await reopened.listReaderAutomaticTranslationCaches('book', 'chapter'),
    ).toHaveLength(1);
    reopened.close();
    const raw = await openDB(databaseName);
    expect(raw.version).toBe(LOCAL_VOLUME_DATABASE_VERSION);
    raw.close();
  });

  it('keeps legacy chapter caches compatible and selectively clears automatic drafts', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const chapter = {
      id: 'book/chapter',
      volumeId: 'book',
      paragraphs: ['原文'],
      segmentIds: ['segment'],
    };
    await dao.createChapter(chapter);
    await dao.putReaderChapterCache({
      key: 'legacy',
      bookId: 'book',
      chapterId: 'chapter',
      contentRevision: 'legacy-revision',
      cachedAt: 1,
    });
    for (const [key, chapterId, purpose] of [
      ['automatic-one', 'chapter', 'automatic'],
      ['retranslate-one', 'chapter', 'retranslate'],
      ['automatic-two', 'other-chapter', 'automatic'],
    ] as const) {
      await dao.upsertReaderAutomaticTranslationCache({
        kind: 'automatic-translation',
        key,
        bookId: 'book',
        chapterId,
        source: 'gpt',
        purpose,
        selectionKey: 'safe-selection-digest',
        glossaryId: 'glossary',
        contentRevision: 'revision',
        ...(purpose === 'retranslate'
          ? {
              formalTranslationRevision:
                getChapterFormalTranslationRevision(chapter),
            }
          : {}),
        entries: [{ segmentId: 'segment', translated: '译文' }],
        cachedAt: 2,
      });
    }

    expect(
      await dao.getReaderAutomaticTranslationCache('legacy'),
    ).toBeUndefined();
    expect(await dao.listReaderChapterCaches('book')).toHaveLength(4);
    expect(
      await dao.deleteReaderAutomaticTranslationCaches({
        bookId: 'book',
        chapterId: 'chapter',
        purpose: 'automatic',
      }),
    ).toBe(1);
    expect(await dao.listReaderAutomaticTranslationCaches('book')).toHaveLength(
      2,
    );
    expect(await dao.listReaderChapterCaches('book')).toContainEqual({
      key: 'legacy',
      bookId: 'book',
      chapterId: 'chapter',
      contentRevision: 'legacy-revision',
      cachedAt: 1,
    });
    dao.close();
  });
});
