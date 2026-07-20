import type {
  CatalogTitleTranslation,
  CatalogTitleTranslations,
} from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';

export interface CatalogTitleEntry {
  title?: string;
  titleTranslations?: CatalogTitleTranslations;
}

const normalizeTitle = (title: string | undefined) => title?.trim() ?? '';

export const getCatalogTitleTranslation = (
  entry: CatalogTitleEntry,
  translatorId: TranslatorId,
): CatalogTitleTranslation | undefined => {
  const translation = entry.titleTranslations?.[translatorId];
  if (
    translation === undefined ||
    normalizeTitle(translation.text).length === 0 ||
    normalizeTitle(translation.sourceTitle) !== normalizeTitle(entry.title)
  ) {
    return undefined;
  }
  return translation;
};

export const isCatalogTitleTranslationCurrent = (
  entry: CatalogTitleEntry,
  translatorId: TranslatorId,
  glossaryId: string,
) => getCatalogTitleTranslation(entry, translatorId)?.glossaryId === glossaryId;

export const selectCatalogTitleTranslation = (
  entry: CatalogTitleEntry,
  translationPriority: readonly TranslatorId[],
) => {
  for (const translatorId of translationPriority) {
    const translation = getCatalogTitleTranslation(entry, translatorId);
    if (translation !== undefined) return translation.text.trim();
  }
  return undefined;
};
