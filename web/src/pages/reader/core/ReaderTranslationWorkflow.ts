import type { ReaderChapterSummary } from '@/model/Reader';
import type { TranslateTaskParams } from '@/model/Translator';

export const getChapterTranslationParams = (
  chapter: ReaderChapterSummary,
): TranslateTaskParams => ({
  level: 'normal',
  forceMetadata: false,
  startIndex: chapter.index,
  endIndex: chapter.index + 1,
});

export const getTranslationStatusLabel = (
  status: ReaderChapterSummary['translationStatus'],
) =>
  ({
    none: '未翻译',
    partial: '部分翻译',
    complete: '已翻译',
  })[status];
