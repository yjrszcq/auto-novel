export type ReaderMode =
  | 'ask'
  | 'translated'
  | 'translated-original'
  | 'original-translated'
  | 'original';

export interface ReaderBookshelfState {
  bookId: string;
  listed: boolean;
  pinned: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface ReaderSettingsRecord {
  id: 'default';
  defaultMode: ReaderMode;
  translationPriority: ('gpt' | 'sakura' | 'youdao' | 'baidu')[];
  updatedAt: number;
}

export interface ReaderBookPreference {
  bookId: string;
  preferredMode?: Exclude<ReaderMode, 'ask'>;
  updatedAt: number;
}

export interface ReaderProgress {
  bookId: string;
  chapterId: string;
  segmentId?: string;
  segmentOffset?: number;
  scrollRatio?: number;
  legacyScrollY?: number;
  mode?: Exclude<ReaderMode, 'ask'>;
  updatedAt: number;
}

export interface ReaderBookmark {
  id: string;
  bookId: string;
  chapterId: string;
  segmentId?: string;
  label?: string;
  createdAt: number;
}

export interface ReaderAnnotation {
  id: string;
  bookId: string;
  chapterId: string;
  segmentId: string;
  languageSide: 'original' | 'translated';
  startOffset: number;
  endOffset: number;
  quote: string;
  note?: string;
  style: 'highlight' | 'underline' | 'strike' | 'wavy';
  createdAt: number;
  updatedAt: number;
}

export interface ReaderCover {
  bookId: string;
  blob: Blob;
  updatedAt: number;
}

export interface ReaderChapterCache {
  key: string;
  bookId: string;
  chapterId: string;
  contentRevision: string;
  cachedAt: number;
}
