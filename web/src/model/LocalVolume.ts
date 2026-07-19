import type { Glossary } from './Glossary';

export interface ChapterTranslation {
  glossaryId: string;
  glossary: Glossary;
  paragraphs: string[];
}

export interface LocalVolumeChapterSourceRange {
  href: string;
  start: number;
  end: number;
  startFragment?: string;
  endFragment?: string;
}

export interface LocalVolumeTocEntry {
  chapterId: string;
  title?: string;
  level?: number;
  parentChapterId?: string;
  baidu?: string;
  youdao?: string;
  gpt?: string;
  sakura?: string;
}

export interface LocalVolumeNavigationEntry {
  id: string;
  title: string;
  level: number;
  href?: string;
  chapterId?: string;
  parentId?: string;
}

export interface LocalBookMetadata {
  title?: string;
  authors?: string[];
  description?: string;
  coverUrl?: string;
  languages?: string[];
}

export type DownloadMetadataPolicy = 'global' | 'embed' | 'source';

interface LocalDownloadMetadataPreference {
  original: DownloadMetadataPolicy;
  translated: DownloadMetadataPolicy;
}

export interface LocalVolumeMetadata {
  id: string;
  readAt?: number;
  createAt: number;
  toc: LocalVolumeTocEntry[];
  navigation?: LocalVolumeNavigationEntry[];
  sourceFormat: 'txt' | 'epub' | 'srt';
  glossaryId: string;
  glossary: Glossary;
  favoredId: string;
  sourceBookMetadata: LocalBookMetadata;
  bookMetadata?: LocalBookMetadata;
  downloadMetadataPreference?: LocalDownloadMetadataPreference;
}

const hasOwn = <Key extends keyof LocalBookMetadata>(
  metadata: LocalBookMetadata,
  key: Key,
) => Object.prototype.hasOwnProperty.call(metadata, key);

export const getLocalBookMetadata = (
  volume: LocalVolumeMetadata,
): LocalBookMetadata => {
  const source = volume.sourceBookMetadata;
  const override = volume.bookMetadata;
  if (override === undefined) return { ...source };
  return {
    title: hasOwn(override, 'title') ? override.title : source.title,
    authors: hasOwn(override, 'authors') ? override.authors : source.authors,
    description: hasOwn(override, 'description')
      ? override.description
      : source.description,
    coverUrl: hasOwn(override, 'coverUrl')
      ? override.coverUrl
      : source.coverUrl,
    languages: hasOwn(override, 'languages')
      ? override.languages
      : source.languages,
  };
};

export const getLocalVolumeTitle = (volume: LocalVolumeMetadata) =>
  getLocalBookMetadata(volume).title?.trim() ||
  volume.id.replace(/\.[^.]+$/, '');

export const getLocalVolumeLanguages = (volume: LocalVolumeMetadata) => {
  const languages = getLocalBookMetadata(volume)
    .languages?.map((language) => language.trim())
    .filter(Boolean);
  return languages?.length ? languages : ['ja'];
};

const chineseLanguageCodes = new Set([
  'zh',
  'zho',
  'chi',
  'cmn',
  'yue',
  'wuu',
  'hak',
  'nan',
  'gan',
]);

export const isChineseLanguageTag = (language: string) =>
  chineseLanguageCodes.has(language.trim().toLowerCase().split('-')[0]);

export const requiresWholeChapterTranslation = (languages: string[]) =>
  !languages.some(isChineseLanguageTag);

export const shouldEmbedDownloadMetadata = (
  volume: LocalVolumeMetadata,
  kind: 'original' | 'translated',
  globalDefault: boolean,
) => {
  const isEpub = volume.sourceFormat === 'epub';
  if (!isEpub) return false;
  const policy = volume.downloadMetadataPreference?.[kind] ?? 'global';
  if (policy === 'embed') return true;
  if (policy === 'source') return false;
  return globalDefault;
};

export interface LocalVolumeChapter {
  id: string;
  volumeId: string;
  paragraphs: string[];
  segmentIds: string[];
  sourceRanges?: LocalVolumeChapterSourceRange[];
  baidu?: ChapterTranslation;
  youdao?: ChapterTranslation;
  gpt?: ChapterTranslation;
  sakura?: ChapterTranslation;
}
