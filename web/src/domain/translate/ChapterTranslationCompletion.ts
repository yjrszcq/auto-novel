import type { LocalVolumeChapter } from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';

export const chapterTranslationSources: TranslatorId[] = [
  'gpt',
  'sakura',
  'youdao',
  'baidu',
];

const hasText = (value: string | undefined) => (value?.trim().length ?? 0) > 0;

export const isChapterTranslationComplete = (
  originals: string[],
  translated: string[] | undefined,
) => {
  if (
    translated === undefined ||
    translated.length !== originals.length ||
    !originals.some(hasText)
  ) {
    return false;
  }
  return originals.every(
    (original, index) => !hasText(original) || hasText(translated[index]),
  );
};

export const hasCompleteChapterTranslation = (chapter: LocalVolumeChapter) =>
  chapterTranslationSources.some((source) =>
    isChapterTranslationComplete(
      chapter.paragraphs,
      chapter[source]?.paragraphs,
    ),
  );
