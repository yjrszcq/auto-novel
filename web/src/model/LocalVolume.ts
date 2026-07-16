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
}

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
