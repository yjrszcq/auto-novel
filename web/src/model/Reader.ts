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
  fontSize?: number;
  lineHeight?: number;
  contentWidth?: number;
  horizontalPadding?: number;
  theme?: 'light' | 'dark' | 'sepia' | 'system';
  updatedAt: number;
}

export interface ReaderBookStyleOverride {
  fontSize?: number;
  lineHeight?: number;
  contentWidth?: number;
  horizontalPadding?: number;
  theme?: ReaderSettingsRecord['theme'];
}

export interface ReaderBookPreference {
  bookId: string;
  preferredMode?: Exclude<ReaderMode, 'ask'>;
  style?: ReaderBookStyleOverride;
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

export interface ReaderReadingStats {
  bookId: string;
  totalReadingMs: number;
  lastReadAt: number;
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

export type ReaderTranslationStatus = 'none' | 'partial' | 'complete';

export interface ReaderBook {
  id: string;
  title: string;
  author?: string;
  coverUrl?: string;
  sourceLanguage: string;
  targetLanguage?: string;
  chapterCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReaderChapterSummary {
  id: string;
  bookId: string;
  index: number;
  title: string;
  hasOriginal: boolean;
  translationStatus: ReaderTranslationStatus;
  translatedSegmentCount: number;
  totalSegmentCount: number;
  translationSources: string[];
}

export interface ReaderSegment {
  id: string;
  index: number;
  original: string;
  translated?: string;
}

export interface ReaderChapterContent {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  title: string;
  segments: ReaderSegment[];
  translationSource?: string;
}

export interface BookReadingCapabilities {
  hasOriginal: boolean;
  hasAnyTranslation: boolean;
  hasCompleteTranslation: boolean;
  translatedChapterCount: number;
  totalChapterCount: number;
  availableTranslationSources: string[];
}

export interface GetReaderChapterInput {
  bookId: string;
  chapterId: string;
}

export interface ReaderContentAdapter {
  getBook(bookId: string): Promise<ReaderBook>;
  getChapters(bookId: string): Promise<ReaderChapterSummary[]>;
  getChapter(input: GetReaderChapterInput): Promise<ReaderChapterContent>;
  preloadChapter?(input: GetReaderChapterInput): void;
  getCapabilities(bookId: string): Promise<BookReadingCapabilities>;
}
