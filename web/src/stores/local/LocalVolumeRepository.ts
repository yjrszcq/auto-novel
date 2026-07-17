import { parseFile } from '@/util/file';
import { createId } from '@/util/id';

import type { Glossary } from '@/model/Glossary';
import type {
  ChapterTranslation,
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';

import { createVolume } from './CreateVolume';
import { embedEpubDownloadMetadata } from './EpubDownloadMetadata';
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
      value.glossaryId = createId();
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

  const getVolume = dao.getMetadata;

  const updateBookMetadata = (
    id: string,
    bookMetadata: NonNullable<LocalVolumeMetadata['bookMetadata']>,
  ) =>
    dao.updateMetadata(id, (value) => ({
      ...value,
      bookMetadata,
    }));

  const updateBookPresentation = (
    id: string,
    {
      bookMetadata,
      downloadMetadataPreference,
      cover,
    }: Pick<
      LocalVolumeMetadata,
      'bookMetadata' | 'downloadMetadataPreference'
    > & {
      cover?: Awaited<ReturnType<typeof dao.getReaderCover>> | null;
    },
  ) =>
    dao.updateBookPresentation({
      id,
      bookMetadata,
      downloadMetadataPreference,
      cover,
    });

  const getOriginalDownloadFile = async ({
    id,
    embedMetadata = false,
  }: {
    id: string;
    embedMetadata?: boolean;
  }) => {
    const stored = await dao.getFile(id);
    if (stored === undefined) throw new Error('原始文件不存在');
    if (!embedMetadata) return { filename: id, blob: stored.file };

    const volume = await getVolume(id);
    if (volume === undefined) throw new Error('小说不存在');
    const parsed = await parseFile(stored.file);
    if (parsed.type !== 'epub') return { filename: id, blob: stored.file };
    await embedEpubDownloadMetadata(dao, parsed, volume);
    return { filename: id, blob: await parsed.toBlob() };
  };

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
    getVolume,
    updateBookMetadata,
    updateBookPresentation,
    getOriginalDownloadFile,
    createVolume: bind(createVolume),
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
