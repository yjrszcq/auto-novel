import type { LocalVolumeChapter } from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';
import type {
  BookReadingCapabilities,
  ReaderChapterSummary,
  ReaderTranslationStatus,
} from '@/model/Reader';
import { isChapterTranslationComplete } from '@/domain/translate/ChapterTranslationCompletion';

export const defaultTranslationPriority: TranslatorId[] = [
  'gpt',
  'sakura',
  'youdao',
  'baidu',
];

const hasText = (text: string | undefined) => Boolean(text?.trim());

export const selectTranslation = (
  chapter: LocalVolumeChapter,
  priority: TranslatorId[] = defaultTranslationPriority,
) => {
  for (const translatorId of priority) {
    const paragraphs = chapter[translatorId]?.paragraphs;
    if (isChapterTranslationComplete(chapter.paragraphs, paragraphs)) {
      return { translatorId, paragraphs };
    }
  }
  for (const translatorId of priority) {
    const paragraphs = chapter[translatorId]?.paragraphs;
    if (paragraphs?.some(hasText)) {
      return { translatorId, paragraphs };
    }
  }
  return undefined;
};

export const getTranslationStatus = (
  originalParagraphs: string[],
  translatedParagraphs: string[] | undefined,
): {
  status: ReaderTranslationStatus;
  translatedSegmentCount: number;
} => {
  const translatedSegmentCount =
    translatedParagraphs?.filter(
      (paragraph, index) =>
        hasText(originalParagraphs[index]) && hasText(paragraph),
    ).length ?? 0;

  if (translatedSegmentCount === 0) {
    return { status: 'none', translatedSegmentCount };
  }
  if (isChapterTranslationComplete(originalParagraphs, translatedParagraphs)) {
    return { status: 'complete', translatedSegmentCount };
  }
  return { status: 'partial', translatedSegmentCount };
};

export const getReadingCapabilities = (
  chapters: ReaderChapterSummary[],
): BookReadingCapabilities => {
  const availableTranslationSources = [
    ...new Set(chapters.flatMap((chapter) => chapter.translationSources)),
  ];
  const translatedChapterCount = chapters.filter(
    (chapter) => chapter.translationStatus !== 'none',
  ).length;
  return {
    hasOriginal: chapters.some((chapter) => chapter.hasOriginal),
    hasAnyTranslation: translatedChapterCount > 0,
    hasCompleteTranslation:
      chapters.length > 0 &&
      chapters.every((chapter) => chapter.translationStatus === 'complete'),
    translatedChapterCount,
    totalChapterCount: chapters.length,
    availableTranslationSources,
  };
};
