import type { DBSchema } from 'idb';
import { openDB } from 'idb';
import { v4 as uuidv4 } from 'uuid';

import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
  LocalVolumeNavigationEntry,
  LocalVolumeTocEntry,
} from '@/model/LocalVolume';
import type {
  ReaderAnnotation,
  ReaderBookPreference,
  ReaderBookshelfState,
  ReaderBookmark,
  ReaderChapterCache,
  ReaderCover,
  ReaderProgress,
  ReaderReadingStats,
  ReaderSettingsRecord,
} from '@/model/Reader';

type Mutator<T> = (value: T) => T;

export interface NativeEpubMigrationCommit {
  bookId: string;
  expectedChapters: LocalVolumeChapter[];
  chapters: LocalVolumeChapter[];
  toc: LocalVolumeTocEntry[];
  navigation: LocalVolumeNavigationEntry[];
  chapterMap: Record<string, string>;
  segmentChapterMap: Record<string, string>;
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
  };
  'reader-annotation': {
    key: string;
    value: ReaderAnnotation;
  };
  'reader-cover': {
    key: string;
    value: ReaderCover;
  };
  'reader-chapter-cache': {
    key: string;
    value: ReaderChapterCache;
  };
}

export const createLocalVolumeDao = async (databaseName = 'volumes') => {
  const db = await openDB<VolumesDBSchema>(databaseName, 4, {
    async upgrade(db, oldVersion, _newVersion, _transaction, _event) {
      if (oldVersion <= 0) {
        db.createObjectStore('metadata', { keyPath: 'id' });
        db.createObjectStore('file', { keyPath: 'id' });
        const store = db.createObjectStore('chapter', { keyPath: 'id' });
        store.createIndex('byVolumeId', 'volumeId');
      }
      if (oldVersion < 3) {
        db.createObjectStore('reader-settings', { keyPath: 'id' });
        db.createObjectStore('reader-bookshelf', { keyPath: 'bookId' });
        db.createObjectStore('reader-book-preference', { keyPath: 'bookId' });
        db.createObjectStore('reader-progress', { keyPath: 'bookId' });
        db.createObjectStore('reader-bookmark', { keyPath: 'id' });
        db.createObjectStore('reader-annotation', { keyPath: 'id' });
        db.createObjectStore('reader-cover', { keyPath: 'bookId' });
        db.createObjectStore('reader-chapter-cache', { keyPath: 'key' });
      }
      if (oldVersion < 4) {
        db.createObjectStore('reader-reading-stats', { keyPath: 'bookId' });
      }
    },
  });

  // Migrate
  const tx = db.transaction('metadata', 'readwrite');
  for await (const cursor of tx.store) {
    const m = cursor.value;
    if (m.favoredId === undefined) {
      m.favoredId = 'default';
      cursor.update(m);
    }
  }
  await tx.done;

  const chapterTx = db.transaction('chapter', 'readwrite');
  for await (const cursor of chapterTx.store) {
    const chapter = cursor.value;
    const previous = chapter.segmentIds ?? [];
    const used = new Set<string>();
    const segmentIds = chapter.paragraphs.map((_, index) => {
      const id = previous[index];
      if (id && !used.has(id)) {
        used.add(id);
        return id;
      }
      const created = uuidv4();
      used.add(created);
      return created;
    });
    const changed =
      previous.length !== segmentIds.length ||
      previous.some((id, index) => id !== segmentIds[index]);
    if (changed) {
      chapter.segmentIds = segmentIds;
      cursor.update(chapter);
    }
  }
  await chapterTx.done;
  //Metadata
  const listMetadata = () => db.getAll('metadata');
  const getMetadata = (id: string) => db.get('metadata', id);
  const deleteMetadata = (id: string) => db.delete('metadata', id);
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

  // File
  const getFile = (id: string) => db.get('file', id);
  const deleteFile = (id: string) => db.delete('file', id);
  const createFile = (id: string, file: File) => db.put('file', { id, file });

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
  const deleteChapterByVolumeId = async (id: string) => {
    const tx = db.transaction('chapter', 'readwrite');
    for await (const cursor of tx.store.index('byVolumeId').iterate(id)) {
      tx.store.delete(cursor.primaryKey);
    }
    await tx.done;
  };
  const listChapterByVolumeId = (id: string) =>
    db.getAllFromIndex('chapter', 'byVolumeId', id);

  const migrateNativeEpub = async (input: NativeEpubMigrationCommit) => {
    const tx = db.transaction(
      [
        'metadata',
        'chapter',
        'reader-progress',
        'reader-bookmark',
        'reader-annotation',
        'reader-chapter-cache',
      ],
      'readwrite',
    );
    const metadataStore = tx.objectStore('metadata');
    const chapterStore = tx.objectStore('chapter');
    const progressStore = tx.objectStore('reader-progress');
    const bookmarkStore = tx.objectStore('reader-bookmark');
    const annotationStore = tx.objectStore('reader-annotation');
    const cacheStore = tx.objectStore('reader-chapter-cache');
    const metadata = await metadataStore.get(input.bookId);
    if (metadata === undefined) throw new Error('小说不存在');
    if (metadata.contentVersion === 2) {
      await tx.done;
      return false;
    }

    const currentChapters = await chapterStore
      .index('byVolumeId')
      .getAll(input.bookId);
    const stableChapterJson = (chapters: LocalVolumeChapter[]) =>
      JSON.stringify(
        [...chapters]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((chapter) => ({ ...chapter })),
      );
    if (
      stableChapterJson(currentChapters) !==
      stableChapterJson(input.expectedChapters)
    ) {
      throw new Error('迁移期间章节数据发生变化');
    }

    const remapChapter = (chapterId: string, segmentId?: string) => {
      if (segmentId !== undefined) {
        const mapped = input.segmentChapterMap[segmentId];
        if (mapped === undefined) throw new Error('无法定位旧阅读段落');
        return mapped;
      }
      const mapped = input.chapterMap[chapterId];
      if (mapped === undefined) throw new Error('无法精确定位旧章节');
      return mapped;
    };

    const progress = await progressStore.get(input.bookId);
    const bookmarks = (await bookmarkStore.getAll()).filter(
      (bookmark) => bookmark.bookId === input.bookId,
    );
    const annotations = (await annotationStore.getAll()).filter(
      (annotation) => annotation.bookId === input.bookId,
    );
    const caches = (await cacheStore.getAll()).filter(
      (cache) => cache.bookId === input.bookId,
    );
    const migratedProgress =
      progress === undefined
        ? undefined
        : {
            ...progress,
            chapterId: remapChapter(progress.chapterId, progress.segmentId),
          };
    const migratedBookmarks = bookmarks.map((bookmark) => ({
      ...bookmark,
      chapterId: remapChapter(bookmark.chapterId, bookmark.segmentId),
    }));
    const migratedAnnotations = annotations.map((annotation) => ({
      ...annotation,
      chapterId: remapChapter(annotation.chapterId, annotation.segmentId),
    }));

    await Promise.all(
      currentChapters.map((chapter) => chapterStore.delete(chapter.id)),
    );
    await Promise.all(
      input.chapters.map((chapter) => chapterStore.put(chapter)),
    );
    await metadataStore.put({
      ...metadata,
      toc: input.toc,
      navigation: input.navigation,
      sourceFormat: 'epub',
      contentVersion: 2,
    });
    if (migratedProgress !== undefined) {
      await progressStore.put(migratedProgress);
    }
    await Promise.all(
      migratedBookmarks.map((bookmark) => bookmarkStore.put(bookmark)),
    );
    await Promise.all(
      migratedAnnotations.map((annotation) => annotationStore.put(annotation)),
    );
    await Promise.all(caches.map((cache) => cacheStore.delete(cache.key)));
    await tx.done;
    return true;
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
  const listReaderBookmarks = async (bookId: string) =>
    (await db.getAll('reader-bookmark')).filter(
      (bookmark) => bookmark.bookId === bookId,
    );
  const getReaderCover = (bookId: string) => db.get('reader-cover', bookId);
  const deleteReaderCover = (bookId: string) =>
    db.delete('reader-cover', bookId);
  const putReaderAnnotation = (value: ReaderAnnotation) =>
    db.put('reader-annotation', value);
  const deleteReaderAnnotation = (id: string) =>
    db.delete('reader-annotation', id);
  const listReaderAnnotations = async (bookId: string) =>
    (await db.getAll('reader-annotation')).filter(
      (annotation) => annotation.bookId === bookId,
    );
  const putReaderCover = (value: ReaderCover) => db.put('reader-cover', value);
  const putReaderChapterCache = (value: ReaderChapterCache) =>
    db.put('reader-chapter-cache', value);
  const listReaderChapterCaches = async (bookId: string) =>
    (await db.getAll('reader-chapter-cache')).filter(
      (cache) => cache.bookId === bookId,
    );
  const deleteReaderDataByVolumeId = async (bookId: string) => {
    const [bookmarks, annotations, caches] = await Promise.all([
      db.getAll('reader-bookmark'),
      db.getAll('reader-annotation'),
      db.getAll('reader-chapter-cache'),
    ]);
    await Promise.all([
      db.delete('reader-bookshelf', bookId),
      db.delete('reader-book-preference', bookId),
      db.delete('reader-progress', bookId),
      db.delete('reader-reading-stats', bookId),
      db.delete('reader-cover', bookId),
      ...bookmarks
        .filter((bookmark) => bookmark.bookId === bookId)
        .map((bookmark) => db.delete('reader-bookmark', bookmark.id)),
      ...annotations
        .filter((annotation) => annotation.bookId === bookId)
        .map((annotation) => db.delete('reader-annotation', annotation.id)),
      ...caches
        .filter((cache) => cache.bookId === bookId)
        .map((cache) => db.delete('reader-chapter-cache', cache.key)),
    ]);
  };
  const close = () => db.close();
  return {
    listMetadata,
    getMetadata,
    deleteMetadata,
    createMetadata,
    updateMetadata,
    //
    getFile,
    deleteFile,
    createFile,
    //
    getChapter,
    createChapter,
    updateChapter,
    deleteChapterByVolumeId,
    listChapterByVolumeId,
    migrateNativeEpub,
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
    putReaderAnnotation,
    deleteReaderAnnotation,
    listReaderAnnotations,
    deleteReaderDataByVolumeId,
    close,
    getReaderCover,
    putReaderCover,
    deleteReaderCover,
    putReaderChapterCache,
    listReaderChapterCaches,
  };
};

export type LocalVolumeDao = Awaited<ReturnType<typeof createLocalVolumeDao>>;
