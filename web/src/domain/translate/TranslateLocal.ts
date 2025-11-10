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
import { useLocalVolumeStore } from '@/stores';
import { runWithConcurrency } from './Concurrency';
import type { SegmentProgressInfo, Translator } from './Translator';

export const translateLocal = async (
  { volumeId }: LocalTranslateTaskDesc,
  { level, startIndex, endIndex }: TranslateTaskParams,
  callback: TranslateTaskCallback,
  translator: Translator,
  signal?: AbortSignal,
  options?: { concurrency?: number; onSegmentProgress?: (info: SegmentProgressInfo) => void },
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

  const chapters = (() => {
    if (level === 'all') {
      return metadata.toc
        .slice(startIndex, endIndex)
        .map((it, idx) => ({ chapterId: it.chapterId, index: idx }));
    } else {
      const untranslatedChapters = metadata.toc
        .slice(startIndex, endIndex)
        .filter((it) => it[translator.id] === undefined)
        .map((it, idx) => ({ chapterId: it.chapterId, index: idx }));
      if (level === 'normal') {
        return untranslatedChapters;
      }

      const expiredChapters = metadata.toc
        .slice(startIndex, endIndex)
        .filter(
          (it) =>
            it[translator.id] !== undefined &&
            it[translator.id] !== metadata.glossaryId,
        )
        .map((it, idx) => ({ chapterId: it.chapterId, index: idx }));
      return untranslatedChapters.concat(expiredChapters);
    }
  })().sort((a, b) => a.chapterId.localeCompare(b.chapterId));

  callback.onStart(chapters.length);
  if (chapters.length === 0) {
    callback.log(`没有需要更新的章节`);
  }

  const forceSeg = level === 'all';
  const concurrency = Math.max(1, options?.concurrency ?? 1);

  const translateChapter = async ({
    chapterId,
    index,
  }: (typeof chapters)[number]) => {
    try {
      callback.log(`\n[${index}] ${volumeId}/${chapterId}`);
      const chapter = await getChapter(chapterId);
      if (chapter === undefined) {
        throw new Error('章节不存在');
      }
      const textsJp = chapter?.paragraphs;

      const oldTextsZh = await localVolumeRepository.getChapter(
        volumeId,
        chapterId,
      );
      const textsZh = await translator.translate(
        textsJp,
        {
          glossary: metadata.glossary,
          oldGlossary: chapter[translator.id]?.glossary,
          oldTextZh: oldTextsZh
            ? oldTextsZh[translator.id]?.paragraphs
            : undefined,
          force: forceSeg,
          signal,
        },
        {
          concurrency,
          chapter: {
            index: index + 1,
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
      callback.onChapterSuccess({ zh: state });
      options?.onSegmentProgress?.({
        chapter: {
          index: index + 1,
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
        callback.onChapterFailure();
        options?.onSegmentProgress?.({
          chapter: {
            index: index + 1,
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
