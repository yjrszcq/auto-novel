import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import {
  getLocalBookMetadata,
  getLocalVolumeTitle,
  requiresWholeChapterTranslation,
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
import { Epub } from '@/util/file';

import {
  createEpubLinkTargets,
  createEpubRichChapter,
} from '@/stores/local/EpubRichChapter';

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
  const languages = metadata.languages;
  const readingLanguages = languages?.length ? languages : ['ja'];
  return {
    id: volume.id,
    sourceFormat: volume.sourceFormat,
    title: getLocalVolumeTitle(volume),
    author: metadata.authors?.join('、'),
    authors: metadata.authors,
    description: metadata.description,
    coverUrl: metadata.coverUrl,
    languages,
    sourceLanguage: readingLanguages[0],
    requiresWholeChapterTranslation:
      requiresWholeChapterTranslation(readingLanguages),
    targetLanguage: 'zh-CN',
    chapterCount: volume.toc.length,
    createdAt: volume.createAt,
    updatedAt: volume.readAt ?? volume.createAt,
  };
};

export type LocalVolumeReaderRepository = Pick<
  Awaited<ReturnType<typeof useLocalVolumeStore>>,
  'getVolume' | 'listChapter'
> &
  Partial<Pick<Awaited<ReturnType<typeof useLocalVolumeStore>>, 'getFile'>>;

export const createLocalVolumeReaderAdapter = (
  repository: LocalVolumeReaderRepository,
  translationPriority: TranslatorId[] = defaultTranslationPriority,
): ReaderContentAdapter => {
  const volumeCache = new Map<string, Promise<LocalVolumeMetadata>>();
  const chapterCache = new Map<
    string,
    Promise<Map<string, LocalVolumeChapter>>
  >();
  const epubCache = new Map<string, Promise<Epub | undefined>>();
  const epubLinkTargetCache = new Map<
    string,
    ReturnType<typeof createEpubLinkTargets>
  >();
  const getVolume = async (bookId: string) => {
    let pending = volumeCache.get(bookId);
    if (pending === undefined) {
      pending = repository.getVolume(bookId).then((volume) => {
        if (volume === undefined) throw new Error('书籍不存在');
        return volume;
      });
      volumeCache.set(bookId, pending);
      pending.catch(() => volumeCache.delete(bookId));
    }
    return pending;
  };

  const getVolumeChapters = (bookId: string) => {
    let pending = chapterCache.get(bookId);
    if (pending === undefined) {
      pending = repository
        .listChapter(bookId)
        .then(
          (chapters) =>
            new Map(chapters.map((chapter) => [chapter.id, chapter])),
        );
      chapterCache.set(bookId, pending);
      pending.catch(() => chapterCache.delete(bookId));
    }
    return pending;
  };

  const getEpub = (bookId: string, volume: LocalVolumeMetadata) => {
    if (volume.sourceFormat !== 'epub' || repository.getFile === undefined) {
      return Promise.resolve(undefined);
    }
    let pending = epubCache.get(bookId);
    if (pending === undefined) {
      pending = repository
        .getFile(bookId)
        .then((stored) =>
          stored === undefined ? undefined : Epub.fromFile(stored.file),
        );
      epubCache.set(bookId, pending);
      pending.catch(() => epubCache.delete(bookId));
    }
    return pending;
  };

  const getChapterSummaries = async (
    bookId: string,
    volume: LocalVolumeMetadata,
  ): Promise<ReaderChapterSummary[]> => {
    const chapters = await getVolumeChapters(bookId);
    return volume.toc.map(({ chapterId, title }, index) => {
      const chapter = chapters.get(`${bookId}/${chapterId}`);
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
    });
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
          ({ id, title, level, chapterId, parentId, href }) => ({
            id,
            title,
            level,
            chapterId,
            parentId,
            href,
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
      const volumeChapters = await getVolumeChapters(bookId);
      const chapter = volumeChapters.get(`${bookId}/${chapterId}`);
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
      const epub = chapter.sourceRanges?.length
        ? await getEpub(bookId, volume)
        : undefined;
      let linkTargets = epubLinkTargetCache.get(bookId);
      if (epub !== undefined && linkTargets === undefined) {
        linkTargets = createEpubLinkTargets(
          epub,
          volume.toc.flatMap(({ chapterId: targetChapterId }) => {
            const target = volumeChapters.get(`${bookId}/${targetChapterId}`);
            return target === undefined ? [] : [target];
          }),
        );
        epubLinkTargetCache.set(bookId, linkTargets);
      }
      const richChapter =
        epub === undefined
          ? undefined
          : createEpubRichChapter(epub, chapter, linkTargets ?? []);
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
          sourceLine: chapter.sourceLines?.[index],
          translated: translation?.paragraphs[index],
        })),
        ...(richChapter === undefined ? {} : { epub: richChapter }),
      } satisfies ReaderChapterContent;
    },

    async getCapabilities(bookId) {
      const volume = await getVolume(bookId);
      return getReadingCapabilities(await getChapterSummaries(bookId, volume));
    },
    invalidateChapter({ bookId }) {
      volumeCache.delete(bookId);
      chapterCache.delete(bookId);
    },
    invalidateBook(bookId) {
      volumeCache.delete(bookId);
      chapterCache.delete(bookId);
      epubCache.delete(bookId);
      epubLinkTargetCache.delete(bookId);
    },
  };
};
