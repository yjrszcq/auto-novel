import type { DBSchema } from 'idb';
import { openDB } from 'idb';

import type {
  ChapterTranslation,
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';
import {
  getChapterFormalTranslationRevision,
  hasCompleteChapterTranslation,
} from '@/domain/translate/ChapterTranslationCompletion';
import type {
  ReaderBookPreference,
  ReaderBookshelfState,
  ReaderAutomaticTranslationCache,
  ReaderBookmark,
  ReaderChapterCache,
  ReaderChapterCacheRecord,
  ReaderCover,
  ReaderProgress,
  ReaderReadingStats,
  ReaderSettingsRecord,
} from '@/model/Reader';

type Mutator<T> = (value: T) => T;

export interface ReplaceTxtCatalogInput {
  bookId: string;
  expectedChapterIds: string[];
  metadata: LocalVolumeMetadata;
  chapters: LocalVolumeChapter[];
  progress?: ReaderProgress;
  bookmarks: ReaderBookmark[];
}

export interface UpdateTxtCatalogTitlesInput {
  bookId: string;
  expectedChapterIds: string[];
  titles: { chapterId: string; title: string }[];
}

interface VolumesDBSchema extends DBSchema {
  metadata: {
    key: string;
    value: LocalVolumeMetadata;
  };
  file: {
    key: string;
    value: {
      id: string;
      file: File;
    };
  };
  chapter: {
    key: string;
    value: LocalVolumeChapter;
    indexes: { byVolumeId: string };
  };
  'reader-settings': {
    key: string;
    value: ReaderSettingsRecord;
  };
  'reader-bookshelf': {
    key: string;
    value: ReaderBookshelfState;
  };
  'reader-book-preference': {
    key: string;
    value: ReaderBookPreference;
  };
  'reader-progress': {
    key: string;
    value: ReaderProgress;
  };
  'reader-reading-stats': {
    key: string;
    value: ReaderReadingStats;
  };
  'reader-bookmark': {
    key: string;
    value: ReaderBookmark;
    indexes: { byBookId: string };
  };
  'reader-cover': {
    key: string;
    value: ReaderCover;
  };
  'reader-chapter-cache': {
    key: string;
    value: ReaderChapterCacheRecord;
    indexes: { byBookId: string };
  };
}

export const LOCAL_VOLUME_DATABASE_VERSION = 6;

export const createLocalVolumeDao = async (databaseName = 'volumes') => {
  const db = await openDB<VolumesDBSchema>(
    databaseName,
    LOCAL_VOLUME_DATABASE_VERSION,
    {
      upgrade(db) {
        for (const storeName of db.objectStoreNames) {
          db.deleteObjectStore(storeName);
        }
        db.createObjectStore('metadata', { keyPath: 'id' });
        db.createObjectStore('file', { keyPath: 'id' });
        const chapterStore = db.createObjectStore('chapter', {
          keyPath: 'id',
        });
        chapterStore.createIndex('byVolumeId', 'volumeId');
        db.createObjectStore('reader-settings', { keyPath: 'id' });
        db.createObjectStore('reader-bookshelf', { keyPath: 'bookId' });
        db.createObjectStore('reader-book-preference', { keyPath: 'bookId' });
        db.createObjectStore('reader-progress', { keyPath: 'bookId' });
        const bookmarkStore = db.createObjectStore('reader-bookmark', {
          keyPath: 'id',
        });
        bookmarkStore.createIndex('byBookId', 'bookId');
        db.createObjectStore('reader-cover', { keyPath: 'bookId' });
        const cacheStore = db.createObjectStore('reader-chapter-cache', {
          keyPath: 'key',
        });
        cacheStore.createIndex('byBookId', 'bookId');
        db.createObjectStore('reader-reading-stats', { keyPath: 'bookId' });
      },
    },
  );
  //Metadata
  const listMetadata = () => db.getAll('metadata');
  const getMetadata = (id: string) => db.get('metadata', id);
  const createMetadata = (value: LocalVolumeMetadata) =>
    db.put('metadata', value);
  const updateMetadata = async (
    id: string,
    mutator: Mutator<LocalVolumeMetadata>,
  ) => {
    const tx = db.transaction('metadata', 'readwrite');
    let value = await tx.store.get(id);
    if (value !== undefined) {
      value = mutator(value);
      await tx.store.put(value);
    }
    await tx.done;
    return value;
  };

  const updateBookPresentation = async ({
    id,
    bookMetadata,
    downloadMetadataPreference,
    txtDownloadAsEpub,
    cover,
  }: Pick<
    LocalVolumeMetadata,
    'id' | 'bookMetadata' | 'downloadMetadataPreference' | 'txtDownloadAsEpub'
  > & {
    cover?: ReaderCover | null;
  }) => {
    const tx = db.transaction(['metadata', 'reader-cover'], 'readwrite');
    const metadataStore = tx.objectStore('metadata');
    const coverStore = tx.objectStore('reader-cover');
    const value = await metadataStore.get(id);
    if (value === undefined) throw new Error('小说不存在');
    await metadataStore.put({
      ...value,
      bookMetadata,
      downloadMetadataPreference,
      txtDownloadAsEpub,
    });
    if (cover === null) await coverStore.delete(id);
    else if (cover !== undefined) await coverStore.put(cover);
    await tx.done;
  };

  // File
  const getFile = (id: string) => db.get('file', id);
  const createFile = (id: string, file: File) => db.put('file', { id, file });

  const createVolume = async ({
    metadata,
    file,
    chapters,
    cover,
  }: {
    metadata: LocalVolumeMetadata;
    file: File;
    chapters: LocalVolumeChapter[];
    cover?: ReaderCover;
  }) => {
    const tx = db.transaction(
      ['metadata', 'file', 'chapter', 'reader-cover'],
      'readwrite',
    );
    if (await tx.objectStore('metadata').get(metadata.id)) {
      throw new Error('小说已经存在');
    }
    await Promise.all([
      tx.objectStore('metadata').add(metadata),
      tx.objectStore('file').add({ id: metadata.id, file }),
      ...chapters.map((chapter) => tx.objectStore('chapter').add(chapter)),
      cover === undefined
        ? Promise.resolve()
        : tx.objectStore('reader-cover').add(cover),
    ]);
    await tx.done;
  };

  // Chapter
  const getChapter = (id: string, chapterId: string) =>
    db.get('chapter', `${id}/${chapterId}`);
  const createChapter = (chapter: LocalVolumeChapter) =>
    db.put('chapter', chapter);
  const updateChapter = async (
    id: string,
    chapterId: string,
    mutator: Mutator<LocalVolumeChapter>,
  ) => {
    const tx = db.transaction('chapter', 'readwrite');
    let value = await tx.store.get(`${id}/${chapterId}`);
    if (value !== undefined) {
      value = mutator(value);
      await tx.store.put(value);
    }
    await tx.done;
    return value;
  };
  const putChapterTranslation = async ({
    bookId,
    chapterId,
    translatorId,
    translation,
  }: {
    bookId: string;
    chapterId: string;
    translatorId: TranslatorId;
    translation: ChapterTranslation;
  }) => {
    const tx = db.transaction(
      ['chapter', 'metadata', 'reader-chapter-cache'],
      'readwrite',
    );
    try {
      const chapterStore = tx.objectStore('chapter');
      const metadataStore = tx.objectStore('metadata');
      const [chapter, metadata] = await Promise.all([
        chapterStore.get(`${bookId}/${chapterId}`),
        metadataStore.get(bookId),
      ]);
      if (chapter === undefined) throw new Error('章节不存在');
      if (metadata === undefined) throw new Error('小说不存在');
      if (!metadata.toc.some((entry) => entry.chapterId === chapterId)) {
        throw new Error('章节不在目录中');
      }
      if (translation.paragraphs.length !== chapter.paragraphs.length) {
        throw new Error('翻译段落数量与原文不一致');
      }
      chapter[translatorId] = translation;
      metadata.toc
        .filter((entry) => entry.chapterId === chapterId)
        .forEach((entry) => (entry[translatorId] = translation.glossaryId));
      const cacheStore = tx.objectStore('reader-chapter-cache');
      const cacheDeletes: Promise<unknown>[] = [];
      if (hasCompleteChapterTranslation(chapter)) {
        for await (const cursor of cacheStore
          .index('byBookId')
          .iterate(bookId)) {
          if (
            cursor.value.kind === 'automatic-translation' &&
            cursor.value.chapterId === chapterId
          ) {
            cacheDeletes.push(cursor.delete());
          }
        }
      }
      await Promise.all([
        chapterStore.put(chapter),
        metadataStore.put(metadata),
        ...cacheDeletes,
      ]);
      await tx.done;
      return metadata;
    } catch (cause) {
      try {
        tx.abort();
      } catch {
        // A failed request may already have aborted the transaction.
      }
      try {
        await tx.done;
      } catch {
        // Preserve the original error below.
      }
      throw cause;
    }
  };
  const listChapterByVolumeId = (id: string) =>
    db.getAllFromIndex('chapter', 'byVolumeId', id);

  const updateTxtCatalogTitles = async ({
    bookId,
    expectedChapterIds,
    titles,
  }: UpdateTxtCatalogTitlesInput) => {
    const tx = db.transaction('metadata', 'readwrite');
    try {
      const current = await tx.store.get(bookId);
      if (current === undefined) throw new Error('小说不存在');
      if (current.sourceFormat !== 'txt')
        throw new Error('只有 TXT 书籍可以编辑目录');
      if (
        current.toc.length !== expectedChapterIds.length ||
        current.toc.some(
          (entry, index) => entry.chapterId !== expectedChapterIds[index],
        )
      )
        throw new Error('目录已在其他位置更新，请重新打开编辑器');
      const titleByChapterId = new Map(
        titles.map(({ chapterId, title }) => [chapterId, title.trim()]),
      );
      if (
        titleByChapterId.size !== current.toc.length ||
        current.toc.some(
          ({ chapterId }) => !titleByChapterId.get(chapterId)?.length,
        )
      )
        throw new Error('目录标题不能为空或缺失');
      const metadata: LocalVolumeMetadata = {
        ...current,
        toc: current.toc.map((entry) => ({
          ...entry,
          title: titleByChapterId.get(entry.chapterId)!,
        })),
        navigation: current.navigation?.map((entry) => ({
          ...entry,
          title:
            entry.chapterId === undefined
              ? entry.title
              : (titleByChapterId.get(entry.chapterId) ?? entry.title),
        })),
      };
      await tx.store.put(metadata);
      await tx.done;
      return metadata;
    } catch (cause) {
      try {
        tx.abort();
      } catch {
        // The transaction may already be inactive after a failed request.
      }
      try {
        await tx.done;
      } catch {
        // Preserve the validation or request error below.
      }
      throw cause;
    }
  };

  const replaceTxtCatalog = async ({
    bookId,
    expectedChapterIds,
    metadata,
    chapters,
    progress,
    bookmarks,
  }: ReplaceTxtCatalogInput) => {
    const tx = db.transaction(
      [
        'metadata',
        'chapter',
        'reader-progress',
        'reader-bookmark',
        'reader-chapter-cache',
      ],
      'readwrite',
    );
    try {
      const metadataStore = tx.objectStore('metadata');
      const chapterStore = tx.objectStore('chapter');
      const bookmarkStore = tx.objectStore('reader-bookmark');
      const cacheStore = tx.objectStore('reader-chapter-cache');
      const [current, oldChapterKeys, oldBookmarkKeys, cacheKeys] =
        await Promise.all([
          metadataStore.get(bookId),
          chapterStore.index('byVolumeId').getAllKeys(bookId),
          bookmarkStore.index('byBookId').getAllKeys(bookId),
          cacheStore.index('byBookId').getAllKeys(bookId),
        ]);
      if (current === undefined) throw new Error('小说不存在');
      if (current.sourceFormat !== 'txt')
        throw new Error('只有 TXT 书籍可以重建目录');
      if (
        current.toc.length !== expectedChapterIds.length ||
        current.toc.some(
          (entry, index) => entry.chapterId !== expectedChapterIds[index],
        )
      )
        throw new Error('目录已在其他位置更新，请重新打开预览');
      if (metadata.id !== bookId) throw new Error('重建目录的书籍标识不一致');
      if (
        (progress !== undefined && progress.bookId !== bookId) ||
        chapters.some(
          (chapter) =>
            chapter.volumeId !== bookId || !chapter.id.startsWith(`${bookId}/`),
        ) ||
        bookmarks.some((bookmark) => bookmark.bookId !== bookId)
      )
        throw new Error('重建目录包含其他书籍的数据');

      const replacementBookmarkIds = new Set(
        bookmarks.map((bookmark) => bookmark.id),
      );
      const writes: Promise<unknown>[] = [];
      const queueWrite = (write: () => Promise<unknown>) => {
        const pending = write();
        void pending.catch(() => undefined);
        writes.push(pending);
      };
      queueWrite(() => metadataStore.put(metadata));
      oldChapterKeys.forEach((key) =>
        queueWrite(() => chapterStore.delete(key)),
      );
      chapters.forEach((chapter) =>
        queueWrite(() => chapterStore.put(chapter)),
      );
      queueWrite(() =>
        progress === undefined
          ? tx.objectStore('reader-progress').delete(bookId)
          : tx.objectStore('reader-progress').put(progress),
      );
      oldBookmarkKeys
        .filter((key) => !replacementBookmarkIds.has(String(key)))
        .forEach((key) => queueWrite(() => bookmarkStore.delete(key)));
      bookmarks.forEach((bookmark) =>
        queueWrite(() => bookmarkStore.put(bookmark)),
      );
      cacheKeys.forEach((key) => queueWrite(() => cacheStore.delete(key)));
      await Promise.all(writes);
      await tx.done;
    } catch (cause) {
      try {
        tx.abort();
      } catch {
        // The transaction may already have aborted because a request failed.
      }
      try {
        await tx.done;
      } catch {
        // Preserve the original error below.
      }
      throw cause;
    }
  };

  // Reader
  const getReaderSettings = () => db.get('reader-settings', 'default');
  const putReaderSettings = (value: ReaderSettingsRecord) =>
    db.put('reader-settings', value);
  const getReaderBookshelf = (bookId: string) =>
    db.get('reader-bookshelf', bookId);
  const listReaderBookshelves = () => db.getAll('reader-bookshelf');
  const putReaderBookshelf = (value: ReaderBookshelfState) =>
    db.put('reader-bookshelf', value);
  const getReaderBookPreference = (bookId: string) =>
    db.get('reader-book-preference', bookId);
  const putReaderBookPreference = (value: ReaderBookPreference) =>
    db.put('reader-book-preference', value);
  const getReaderProgress = (bookId: string) =>
    db.get('reader-progress', bookId);
  const putReaderProgress = (value: ReaderProgress) =>
    db.put('reader-progress', value);
  const getReaderReadingStats = (bookId: string) =>
    db.get('reader-reading-stats', bookId);
  const putReaderReadingStats = (value: ReaderReadingStats) =>
    db.put('reader-reading-stats', value);
  const putReaderBookmark = (value: ReaderBookmark) =>
    db.put('reader-bookmark', value);
  const deleteReaderBookmark = (id: string) => db.delete('reader-bookmark', id);
  const listReaderBookmarks = (bookId: string) =>
    db.getAllFromIndex('reader-bookmark', 'byBookId', bookId);
  const getReaderCover = (bookId: string) => db.get('reader-cover', bookId);
  const deleteReaderCover = (bookId: string) =>
    db.delete('reader-cover', bookId);
  const putReaderCover = (value: ReaderCover) => db.put('reader-cover', value);
  const putReaderChapterCache = (value: ReaderChapterCache) =>
    db.put('reader-chapter-cache', value);
  const listReaderChapterCaches = (bookId: string) =>
    db.getAllFromIndex('reader-chapter-cache', 'byBookId', bookId);
  const isReaderAutomaticTranslationCache = (
    value: ReaderChapterCacheRecord | undefined,
  ): value is ReaderAutomaticTranslationCache =>
    value?.kind === 'automatic-translation';
  const getReaderAutomaticTranslationCache = async (key: string) => {
    const value = await db.get('reader-chapter-cache', key);
    return isReaderAutomaticTranslationCache(value) ? value : undefined;
  };
  const listReaderAutomaticTranslationCaches = async (
    bookId: string,
    chapterId?: string,
  ) =>
    (await db.getAllFromIndex('reader-chapter-cache', 'byBookId', bookId))
      .filter(isReaderAutomaticTranslationCache)
      .filter(
        (value) => chapterId === undefined || value.chapterId === chapterId,
      );
  const upsertReaderAutomaticTranslationCache = async (
    value: ReaderAutomaticTranslationCache,
  ) => {
    const tx = db.transaction(['chapter', 'reader-chapter-cache'], 'readwrite');
    const cacheStore = tx.objectStore('reader-chapter-cache');
    const chapter = await tx
      .objectStore('chapter')
      .get(`${value.bookId}/${value.chapterId}`);
    if (
      value.purpose === 'automatic' &&
      chapter !== undefined &&
      hasCompleteChapterTranslation(chapter)
    ) {
      for await (const cursor of cacheStore
        .index('byBookId')
        .iterate(value.bookId)) {
        if (
          cursor.value.kind === 'automatic-translation' &&
          cursor.value.chapterId === value.chapterId
        ) {
          await cursor.delete();
        }
      }
      await tx.done;
      return undefined;
    }
    if (
      value.purpose === 'retranslate' &&
      (chapter === undefined ||
        value.formalTranslationRevision === undefined ||
        value.formalTranslationRevision !==
          getChapterFormalTranslationRevision(chapter))
    ) {
      await cacheStore.delete(value.key);
      await tx.done;
      return undefined;
    }
    const existing = await cacheStore.get(value.key);
    const canMerge =
      isReaderAutomaticTranslationCache(existing) &&
      existing.bookId === value.bookId &&
      existing.chapterId === value.chapterId &&
      existing.source === value.source &&
      existing.purpose === value.purpose &&
      existing.selectionKey === value.selectionKey &&
      existing.glossaryId === value.glossaryId &&
      existing.contentRevision === value.contentRevision &&
      existing.formalTranslationRevision === value.formalTranslationRevision;
    const entries = new Map(
      (canMerge ? existing.entries : []).map((entry) => [
        entry.segmentId,
        entry,
      ]),
    );
    value.entries.forEach((entry) => entries.set(entry.segmentId, entry));
    const stored: ReaderAutomaticTranslationCache = {
      ...value,
      entries: [...entries.values()],
    };
    await cacheStore.put(stored);
    await tx.done;
    return stored;
  };
  const deleteReaderAutomaticTranslationCache = async (key: string) => {
    const tx = db.transaction('reader-chapter-cache', 'readwrite');
    const value = await tx.store.get(key);
    if (isReaderAutomaticTranslationCache(value)) {
      await tx.store.delete(key);
    }
    await tx.done;
  };
  const deleteReaderAutomaticTranslationCaches = async ({
    bookId,
    chapterId,
    source,
    purpose,
  }: {
    bookId: string;
    chapterId?: string;
    source?: ReaderAutomaticTranslationCache['source'];
    purpose?: ReaderAutomaticTranslationCache['purpose'];
  }) => {
    const tx = db.transaction('reader-chapter-cache', 'readwrite');
    let deleted = 0;
    for await (const cursor of tx.store.index('byBookId').iterate(bookId)) {
      const value = cursor.value;
      if (
        isReaderAutomaticTranslationCache(value) &&
        (chapterId === undefined || value.chapterId === chapterId) &&
        (source === undefined || value.source === source) &&
        (purpose === undefined || value.purpose === purpose)
      ) {
        await cursor.delete();
        deleted += 1;
      }
    }
    await tx.done;
    return deleted;
  };
  const deleteVolume = async (bookId: string) => {
    const tx = db.transaction(
      [
        'metadata',
        'file',
        'chapter',
        'reader-bookshelf',
        'reader-book-preference',
        'reader-progress',
        'reader-reading-stats',
        'reader-cover',
        'reader-bookmark',
        'reader-chapter-cache',
      ],
      'readwrite',
    );
    const deleteChapters = async () => {
      for await (const cursor of tx
        .objectStore('chapter')
        .index('byVolumeId')
        .iterate(bookId)) {
        cursor.delete();
      }
    };
    const deleteBookmarks = async () => {
      for await (const cursor of tx
        .objectStore('reader-bookmark')
        .index('byBookId')
        .iterate(bookId)) {
        cursor.delete();
      }
    };
    const deleteCaches = async () => {
      for await (const cursor of tx
        .objectStore('reader-chapter-cache')
        .index('byBookId')
        .iterate(bookId)) {
        cursor.delete();
      }
    };
    await Promise.all([
      tx.objectStore('metadata').delete(bookId),
      tx.objectStore('file').delete(bookId),
      tx.objectStore('reader-bookshelf').delete(bookId),
      tx.objectStore('reader-book-preference').delete(bookId),
      tx.objectStore('reader-progress').delete(bookId),
      tx.objectStore('reader-reading-stats').delete(bookId),
      tx.objectStore('reader-cover').delete(bookId),
      deleteChapters(),
      deleteBookmarks(),
      deleteCaches(),
    ]);
    await tx.done;
  };
  const close = () => db.close();
  return {
    listMetadata,
    getMetadata,
    createMetadata,
    updateMetadata,
    updateBookPresentation,
    //
    getFile,
    createFile,
    createVolume,
    //
    getChapter,
    createChapter,
    updateChapter,
    putChapterTranslation,
    listChapterByVolumeId,
    updateTxtCatalogTitles,
    replaceTxtCatalog,
    //
    getReaderSettings,
    putReaderSettings,
    getReaderBookshelf,
    listReaderBookshelves,
    putReaderBookshelf,
    getReaderBookPreference,
    putReaderBookPreference,
    getReaderProgress,
    putReaderProgress,
    getReaderReadingStats,
    putReaderReadingStats,
    putReaderBookmark,
    deleteReaderBookmark,
    listReaderBookmarks,
    deleteVolume,
    close,
    getReaderCover,
    putReaderCover,
    deleteReaderCover,
    putReaderChapterCache,
    listReaderChapterCaches,
    getReaderAutomaticTranslationCache,
    listReaderAutomaticTranslationCaches,
    upsertReaderAutomaticTranslationCache,
    deleteReaderAutomaticTranslationCache,
    deleteReaderAutomaticTranslationCaches,
  };
};

export type LocalVolumeDao = Awaited<ReturnType<typeof createLocalVolumeDao>>;
