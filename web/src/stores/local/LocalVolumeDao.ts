import type { DBSchema } from 'idb';
import { openDB } from 'idb';

import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
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
  'reader-annotation': {
    key: string;
    value: ReaderAnnotation;
    indexes: { byBookId: string };
  };
  'reader-cover': {
    key: string;
    value: ReaderCover;
  };
  'reader-chapter-cache': {
    key: string;
    value: ReaderChapterCache;
    indexes: { byBookId: string };
  };
}

export const createLocalVolumeDao = async (databaseName = 'volumes') => {
  const db = await openDB<VolumesDBSchema>(databaseName, 5, {
    upgrade(db) {
      for (const storeName of db.objectStoreNames) {
        db.deleteObjectStore(storeName);
      }
      db.createObjectStore('metadata', { keyPath: 'id' });
      db.createObjectStore('file', { keyPath: 'id' });
      const chapterStore = db.createObjectStore('chapter', { keyPath: 'id' });
      chapterStore.createIndex('byVolumeId', 'volumeId');
      db.createObjectStore('reader-settings', { keyPath: 'id' });
      db.createObjectStore('reader-bookshelf', { keyPath: 'bookId' });
      db.createObjectStore('reader-book-preference', { keyPath: 'bookId' });
      db.createObjectStore('reader-progress', { keyPath: 'bookId' });
      const bookmarkStore = db.createObjectStore('reader-bookmark', {
        keyPath: 'id',
      });
      bookmarkStore.createIndex('byBookId', 'bookId');
      const annotationStore = db.createObjectStore('reader-annotation', {
        keyPath: 'id',
      });
      annotationStore.createIndex('byBookId', 'bookId');
      db.createObjectStore('reader-cover', { keyPath: 'bookId' });
      const cacheStore = db.createObjectStore('reader-chapter-cache', {
        keyPath: 'key',
      });
      cacheStore.createIndex('byBookId', 'bookId');
      db.createObjectStore('reader-reading-stats', { keyPath: 'bookId' });
    },
  });
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
    cover,
  }: Pick<
    LocalVolumeMetadata,
    'id' | 'bookMetadata' | 'downloadMetadataPreference'
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
  const listChapterByVolumeId = (id: string) =>
    db.getAllFromIndex('chapter', 'byVolumeId', id);

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
  const putReaderAnnotation = (value: ReaderAnnotation) =>
    db.put('reader-annotation', value);
  const deleteReaderAnnotation = (id: string) =>
    db.delete('reader-annotation', id);
  const listReaderAnnotations = (bookId: string) =>
    db.getAllFromIndex('reader-annotation', 'byBookId', bookId);
  const putReaderCover = (value: ReaderCover) => db.put('reader-cover', value);
  const putReaderChapterCache = (value: ReaderChapterCache) =>
    db.put('reader-chapter-cache', value);
  const listReaderChapterCaches = (bookId: string) =>
    db.getAllFromIndex('reader-chapter-cache', 'byBookId', bookId);
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
        'reader-annotation',
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
    const deleteAnnotations = async () => {
      for await (const cursor of tx
        .objectStore('reader-annotation')
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
      deleteAnnotations(),
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
    listChapterByVolumeId,
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
    deleteVolume,
    close,
    getReaderCover,
    putReaderCover,
    deleteReaderCover,
    putReaderChapterCache,
    listReaderChapterCaches,
  };
};

export type LocalVolumeDao = Awaited<ReturnType<typeof createLocalVolumeDao>>;
