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

export interface LocalDownloadMetadataPreference {
  original: DownloadMetadataPolicy;
  translated: DownloadMetadataPolicy;
}

export interface LocalVolumeMetadata {
  id: string;
  readAt?: number;
  createAt: number;
  toc: LocalVolumeTocEntry[];
  navigation?: LocalVolumeNavigationEntry[];
  sourceFormat?: 'txt' | 'epub' | 'srt';
  contentVersion?: number;
  glossaryId: string;
  glossary: Glossary;
  favoredId: string;
  sourceBookMetadata?: LocalBookMetadata;
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
  const source = volume.sourceBookMetadata ?? {};
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
