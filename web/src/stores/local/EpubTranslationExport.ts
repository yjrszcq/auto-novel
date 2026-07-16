import type { LocalVolumeChapterSourceRange } from '@/model/LocalVolume';

export interface EpubChapterTranslationSlice {
  sourceRanges: readonly LocalVolumeChapterSourceRange[];
  translations: readonly (readonly string[])[];
}

export const collectEpubSourceTranslations = (
  chapters: readonly EpubChapterTranslationSlice[],
) => {
  const bySource = new Map<string, string[][]>();
  for (const chapter of chapters) {
    let chapterOffset = 0;
    for (const range of chapter.sourceRanges) {
      const paragraphTranslations = bySource.get(range.href) ?? [];
      while (paragraphTranslations.length < range.end) {
        paragraphTranslations.push([]);
      }
      for (
        let sourceIndex = range.start;
        sourceIndex < range.end;
        sourceIndex += 1
      ) {
        const chapterIndex = chapterOffset + sourceIndex - range.start;
        paragraphTranslations[sourceIndex] = chapter.translations.flatMap(
          (lines) =>
            lines[chapterIndex] === undefined ? [] : [lines[chapterIndex]],
        );
      }
      bySource.set(range.href, paragraphTranslations);
      chapterOffset += range.end - range.start;
    }
  }
  return bySource;
};
