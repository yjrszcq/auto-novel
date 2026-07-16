import { v4 as uuidv4 } from 'uuid';

import type { Glossary } from '@/model/Glossary';
import type {
  ChapterTranslation,
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';

import { createVolume } from './CreateVolume';
import { ensureNativeEpubMigration } from './EpubMigration';
import { getTranslationFile } from './GetTranslationFile';
import type { LocalVolumeDao } from './LocalVolumeDao';
import { createLocalVolumeDao } from './LocalVolumeDao';

export const createLocalVolumeStore = async () => {
  const dao = await createLocalVolumeDao();

  const deleteVolume = (id: string) =>
    Promise.all([
      dao.deleteChapterByVolumeId(id),
      dao.deleteMetadata(id),
      dao.deleteFile(id),
      dao.deleteReaderDataByVolumeId(id),
    ]);

  const updateGlossary = (id: string, glossary: Glossary) =>
    dao.updateMetadata(id, (value) => {
      value.glossary = glossary;
      value.glossaryId = uuidv4();
      return value;
    });

  const updateReadAt = (id: string) =>
    dao.updateMetadata(id, (value) => {
      value.readAt = Date.now();
      return value;
    });

  const updateFavoredId = (id: string, favoredId: string) =>
    dao.updateMetadata(id, (value) => {
      value.favoredId = favoredId;
      return value;
    });

  const updateTranslation = async (
    id: string,
    chapterId: string,
    translatorId: TranslatorId,
    translation: ChapterTranslation,
  ) => {
    const chapter = await dao.updateChapter(
      id,
      chapterId,
      (value: LocalVolumeChapter) => {
        value[translatorId] = translation;
        return value;
      },
    );
    if (chapter === undefined) {
      throw '章节不存在';
    }
    const metadata = await dao.updateMetadata(
      id,
      (value: LocalVolumeMetadata) => {
        value.toc
          .filter((it) => it.chapterId === chapterId)
          .forEach((it) => (it[translatorId] = translation.glossaryId));
        return value;
      },
    );
    if (metadata === undefined) {
      throw '小说不存在';
    }
    return metadata.toc.filter((it) => it[translatorId] !== undefined).length;
  };

  const bind = <Args extends Array<unknown>, Return>(
    fn: (dao: LocalVolumeDao, ...args: Args) => Promise<Return>,
  ) => {
    return async (...args: Args): Promise<Return> => {
      return fn(dao, ...args);
    };
  };

  return {
    getFile: dao.getFile,
    //
    listVolume: dao.listMetadata,
    getVolume: dao.getMetadata,
    createVolume: bind(createVolume),
    ensureNativeEpubMigration: bind(ensureNativeEpubMigration),
    deleteVolume,
    updateGlossary,
    updateReadAt,
    updateFavoredId,
    //
    getChapter: dao.getChapter,
    updateTranslation,
    // Reader
    getReaderSettings: dao.getReaderSettings,
    putReaderSettings: dao.putReaderSettings,
    getReaderBookshelf: dao.getReaderBookshelf,
    listReaderBookshelves: dao.listReaderBookshelves,
    putReaderBookshelf: dao.putReaderBookshelf,
    getReaderBookPreference: dao.getReaderBookPreference,
    putReaderBookPreference: dao.putReaderBookPreference,
    getReaderProgress: dao.getReaderProgress,
    putReaderProgress: dao.putReaderProgress,
    getReaderReadingStats: dao.getReaderReadingStats,
    putReaderReadingStats: dao.putReaderReadingStats,
    putReaderBookmark: dao.putReaderBookmark,
    deleteReaderBookmark: dao.deleteReaderBookmark,
    listReaderBookmarks: dao.listReaderBookmarks,
    putReaderAnnotation: dao.putReaderAnnotation,
    deleteReaderAnnotation: dao.deleteReaderAnnotation,
    listReaderAnnotations: dao.listReaderAnnotations,
    getReaderCover: dao.getReaderCover,
    putReaderCover: dao.putReaderCover,
    deleteReaderCover: dao.deleteReaderCover,
    putReaderChapterCache: dao.putReaderChapterCache,
    //
    getTranslationFile: bind(getTranslationFile),
  };
};
