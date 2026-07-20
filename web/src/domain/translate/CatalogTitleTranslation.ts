import type {
  CatalogTitleTranslation,
  CatalogTitleTranslations,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import type { TranslateTaskParams, TranslatorId } from '@/model/Translator';

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

export interface CatalogTitleTranslationPlanTarget {
  id: string;
  sourceTitle: string;
}

export interface CatalogTitleTranslationPlan {
  sourceTitles: string[];
  toc: CatalogTitleTranslationPlanTarget[];
  navigation: CatalogTitleTranslationPlanTarget[];
}

export const createCatalogTitleTranslationPlan = (
  metadata: LocalVolumeMetadata,
  translatorId: TranslatorId,
  level: TranslateTaskParams['level'],
  forceMetadata: boolean,
): CatalogTitleTranslationPlan => {
  const sourceTitles = new Set<string>();
  const shouldTranslate = (entry: CatalogTitleEntry) => {
    const sourceTitle = normalizeTitle(entry.title);
    if (sourceTitle.length === 0) return false;
    if (forceMetadata || level === 'all') return true;
    if (level === 'normal') {
      return getCatalogTitleTranslation(entry, translatorId) === undefined;
    }
    return !isCatalogTitleTranslationCurrent(
      entry,
      translatorId,
      metadata.glossaryId,
    );
  };
  const collect = <Entry extends CatalogTitleEntry>(
    entries: readonly Entry[],
    getId: (entry: Entry) => string,
  ) =>
    entries.flatMap((entry) => {
      if (!shouldTranslate(entry)) return [];
      const sourceTitle = normalizeTitle(entry.title);
      sourceTitles.add(sourceTitle);
      return [{ id: getId(entry), sourceTitle }];
    });

  const toc = collect(metadata.toc, (entry) => entry.chapterId);
  const navigation = collect(metadata.navigation ?? [], (entry) => entry.id);
  return { sourceTitles: [...sourceTitles], toc, navigation };
};
