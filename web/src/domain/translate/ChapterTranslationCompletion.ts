import type { LocalVolumeChapter } from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';

export const chapterTranslationSources: TranslatorId[] = [
  'sakura',
  'gpt',
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

export const getChapterFormalTranslationRevision = (
  chapter: LocalVolumeChapter,
) => {
  const value = chapterTranslationSources
    .map((source) => {
      const translation = chapter[source];
      return translation === undefined
        ? `${source}:`
        : `${source}:${translation.glossaryId}:${translation.paragraphs.join('\u0001')}`;
    })
    .join('\u0002');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return [first, second]
    .map((part) => (part >>> 0).toString(36).padStart(7, '0'))
    .join('');
};
