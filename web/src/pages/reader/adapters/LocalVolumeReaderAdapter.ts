import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import {
  getLocalBookMetadata,
  getLocalVolumeLanguages,
  getLocalVolumeTitle,
} from '@/model/LocalVolume';
import type {
  ReaderBook,
  ReaderChapterContent,
  ReaderChapterSummary,
  ReaderContentAdapter,
  ReaderNavigationEntry,
} from '@/model/Reader';
import type { TranslatorId } from '@/model/Translator';
import type { useLocalVolumeStore } from '@/stores';

import {
  defaultTranslationPriority,
  getReadingCapabilities,
  getTranslationStatus,
  selectTranslation,
} from '../core/capabilities';

const formatTitle = (id: string) => id.replace(/\.[^.]+$/, '');

const getChapterTitle = (
  bookId: string,
  chapterId: string,
  title: string | undefined,
) => title?.trim() || `${formatTitle(bookId)} - ${chapterId}`;

const getChapterSources = (chapter: LocalVolumeChapter) =>
  (['sakura', 'gpt', 'youdao', 'baidu'] as const).filter((translatorId) =>
    chapter[translatorId]?.paragraphs.some(Boolean),
  );

const getBook = (volume: LocalVolumeMetadata): ReaderBook => {
  const metadata = getLocalBookMetadata(volume);
  const languages = getLocalVolumeLanguages(volume);
  return {
    id: volume.id,
    title: getLocalVolumeTitle(volume),
    author: metadata.authors?.join('、'),
    authors: metadata.authors,
    description: metadata.description,
    coverUrl: metadata.coverUrl,
    languages,
    sourceLanguage: languages[0],
    targetLanguage: 'zh-CN',
    chapterCount: volume.toc.length,
    createdAt: volume.createAt,
    updatedAt: volume.readAt ?? volume.createAt,
  };
};

export type LocalVolumeReaderRepository = Pick<
  Awaited<ReturnType<typeof useLocalVolumeStore>>,
  'getVolume' | 'getChapter'
>;

export const createLocalVolumeReaderAdapter = (
  repository: LocalVolumeReaderRepository,
  translationPriority: TranslatorId[] = defaultTranslationPriority,
): ReaderContentAdapter => {
  const getVolume = async (bookId: string) => {
    const volume = await repository.getVolume(bookId);
    if (volume === undefined) {
      throw new Error('书籍不存在');
    }
    return volume;
  };

  const getChapterSummaries = async (
    bookId: string,
    volume: LocalVolumeMetadata,
  ): Promise<ReaderChapterSummary[]> => {
    return Promise.all(
      volume.toc.map(async ({ chapterId, title }, index) => {
        const chapter = await repository.getChapter(bookId, chapterId);
        if (chapter === undefined) {
          throw new Error('章节不存在');
        }
        const translation = selectTranslation(chapter, translationPriority);
        const { status, translatedSegmentCount } = getTranslationStatus(
          chapter.paragraphs,
          translation?.paragraphs,
        );
        return {
          id: chapterId,
          bookId,
          index,
          title: getChapterTitle(bookId, chapterId, title),
          hasOriginal: chapter.paragraphs.length > 0,
          translationStatus: status,
          translatedSegmentCount,
          totalSegmentCount: chapter.paragraphs.length,
          translationSources: getChapterSources(chapter),
        };
      }),
    );
  };

  return {
    async getBook(bookId) {
      const volume = await getVolume(bookId);
      return getBook(volume);
    },

    async getChapters(bookId) {
      const volume = await getVolume(bookId);
      return getChapterSummaries(bookId, volume);
    },

    async getNavigation(bookId) {
      const volume = await getVolume(bookId);
      if (volume.navigation?.length) {
        return volume.navigation.map(
          ({ id, title, level, chapterId, parentId }) => ({
            id,
            title,
            level,
            chapterId,
            parentId,
          }),
        ) satisfies ReaderNavigationEntry[];
      }
      return volume.toc.map(({ chapterId, title, level }, index) => ({
        id: chapterId,
        title: getChapterTitle(bookId, chapterId, title),
        level: level ?? 0,
        chapterId,
        parentId:
          level !== undefined && level > 0
            ? volume.toc
                .slice(0, index)
                .reverse()
                .find((entry) => (entry.level ?? 0) < level)?.chapterId
            : undefined,
      }));
    },

    async getChapter({ bookId, chapterId }) {
      const volume = await getVolume(bookId);
      const chapter = await repository.getChapter(bookId, chapterId);
      if (chapter === undefined) {
        throw new Error('章节不存在');
      }
      const chapterIndex = volume.toc.findIndex(
        (item) => item.chapterId === chapterId,
      );
      if (chapterIndex < 0) {
        throw new Error('章节不存在');
      }
      const translation = selectTranslation(chapter, translationPriority);
      return {
        bookId,
        chapterId,
        chapterIndex,
        title: getChapterTitle(
          bookId,
          chapterId,
          volume.toc[chapterIndex].title,
        ),
        translationSource: translation?.translatorId,
        segments: chapter.paragraphs.map((original, index) => ({
          id: chapter.segmentIds[index],
          index,
          original,
          translated: translation?.paragraphs[index],
        })),
      } satisfies ReaderChapterContent;
    },

    async getCapabilities(bookId) {
      const volume = await getVolume(bookId);
      return getReadingCapabilities(await getChapterSummaries(bookId, volume));
    },
  };
};
