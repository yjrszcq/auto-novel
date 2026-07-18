import { formatError } from '@/api';
import type {
  ChapterTranslation,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import type {
  LocalTranslateTaskDesc,
  TranslateTaskCallback,
  TranslateTaskParams,
} from '@/model/Translator';
import { normalizeTranslationConcurrency } from '@/model/Translator';
import { useLocalVolumeStore } from '@/stores';
import {
  createConcurrencyLimiter,
  normalizeConcurrencyLimit,
  runWithConcurrency,
} from './Concurrency';
import type {
  SegmentDispatcher,
  SegmentProgressInfo,
  Translator,
} from './Translator';

export const translateLocal = async (
  { volumeId }: LocalTranslateTaskDesc,
  { level, startIndex, endIndex, chapterIds }: TranslateTaskParams,
  callback: TranslateTaskCallback,
  translator: Translator,
  signal?: AbortSignal,
  options?: {
    concurrency?: number;
    segmentDispatcher?: SegmentDispatcher;
    onSegmentProgress?: (info: SegmentProgressInfo) => void;
  },
) => {
  const localVolumeRepository = await useLocalVolumeStore();
  // Api
  const getVolume = () => localVolumeRepository.getVolume(volumeId);

  const getChapter = (chapterId: string) =>
    localVolumeRepository.getChapter(volumeId, chapterId);

  const updateTranslation = (chapterId: string, json: ChapterTranslation) =>
    localVolumeRepository.updateTranslation(
      volumeId,
      chapterId,
      translator.id,
      json,
    );

  // Task
  let metadata: LocalVolumeMetadata;
  try {
    callback.log(`获取未翻译章节 ${volumeId}`);
    const metadataOrUndefined = await getVolume();
    if (metadataOrUndefined === undefined) {
      throw '小说不存在';
    } else {
      metadata = metadataOrUndefined;
    }
  } catch (e: unknown) {
    callback.log(`发生错误，结束翻译任务：${e}`);
    return;
  }

  const requestedChapterIds = new Set(chapterIds ?? []);
  const chapters = metadata.toc
    .map((chapter, tocIndex) => ({ chapter, tocIndex }))
    .slice(startIndex, endIndex)
    .filter(
      ({ chapter }) =>
        chapterIds === undefined || requestedChapterIds.has(chapter.chapterId),
    )
    .filter(({ chapter }) => {
      if (level === 'all') return true;
      if (chapter[translator.id] === undefined) return true;
      return (
        level !== 'normal' && chapter[translator.id] !== metadata.glossaryId
      );
    })
    .map(({ chapter, tocIndex }) => ({
      chapterId: chapter.chapterId,
      tocIndex,
    }));

  callback.onStart(
    chapters.length,
    chapters.map(({ chapterId }) => chapterId),
  );
  if (chapters.length === 0) {
    callback.log(`没有需要更新的章节`);
  }

  const forceSeg = level === 'all';
  const concurrency = options?.segmentDispatcher
    ? normalizeConcurrencyLimit(options.concurrency)
    : normalizeTranslationConcurrency(options?.concurrency);
  const requestLimiter = createConcurrencyLimiter(concurrency);

  const translateChapter = async (
    { chapterId, tocIndex }: (typeof chapters)[number],
    schedulerIndex: number,
    workerSignal: AbortSignal,
  ) => {
    try {
      callback.log(`\n[${tocIndex + 1}] ${volumeId}/${chapterId}`);
      const chapter = await getChapter(chapterId);
      if (chapter === undefined) {
        throw new Error('章节不存在');
      }
      const textsJp = chapter?.paragraphs;

      const textsZh = await translator.translate(
        textsJp,
        {
          glossary: metadata.glossary,
          oldGlossary: chapter[translator.id]?.glossary,
          oldTextZh: chapter[translator.id]?.paragraphs,
          force: forceSeg,
          signal: workerSignal,
        },
        {
          concurrency,
          requestLimiter:
            options?.segmentDispatcher === undefined
              ? requestLimiter
              : undefined,
          segmentDispatcher: options?.segmentDispatcher,
          chapter: {
            index: schedulerIndex + 1,
            total: chapters.length,
            id: chapterId,
          },
          onSegmentProgress: options?.onSegmentProgress,
        },
      );

      callback.log('上传章节');
      const state = await updateTranslation(chapterId, {
        glossaryId: metadata.glossaryId,
        glossary: metadata.glossary,
        paragraphs: textsZh,
      });
      callback.onChapterSuccess({ chapterId, zh: state });
      options?.onSegmentProgress?.({
        chapter: {
          index: schedulerIndex + 1,
          total: chapters.length,
          id: chapterId,
        },
        segmentIndex: 0,
        segmentTotal: 0,
        status: 'complete',
      });
    } catch (e) {
      if (e === 'quit') {
        callback.log(`发生错误，结束翻译任务`);
        throw e;
      } else if (e instanceof DOMException && e.name === 'AbortError') {
        callback.log(`中止翻译任务`);
        throw e;
      } else {
        callback.log(`发生错误，跳过：${await formatError(e)}`);
        callback.onChapterFailure(chapterId);
        options?.onSegmentProgress?.({
          chapter: {
            index: schedulerIndex + 1,
            total: chapters.length,
            id: chapterId,
          },
          segmentIndex: 0,
          segmentTotal: 0,
          status: 'failed',
        });
      }
    }
  };

  try {
    await runWithConcurrency(chapters, concurrency, translateChapter, signal);
  } catch (e) {
    if (e === 'quit') {
      return;
    } else if (e instanceof DOMException && e.name === 'AbortError') {
      return 'abort';
    }
    throw e;
  }
};
