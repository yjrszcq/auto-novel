export type ReaderMode =
  'translated' | 'translated-original' | 'original-translated' | 'original';

export type ReaderFlow = 'auto' | 'paginated' | 'scrolled';

export interface ReaderBookshelfState {
  bookId: string;
  pinned: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface ReaderSettingsRecord {
  id: 'default';
  defaultMode: ReaderMode;
  translationPriority: ('gpt' | 'sakura' | 'youdao' | 'baidu')[];
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  horizontalPadding: number;
  theme: 'light' | 'dark' | 'sepia' | 'system';
  flow: ReaderFlow;
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
  preferredMode?: ReaderMode;
  style?: ReaderBookStyleOverride;
  updatedAt: number;
}

export interface ReaderProgress {
  bookId: string;
  chapterId: string;
  segmentId?: string;
  segmentOffset?: number;
  scrollRatio?: number;
  mode?: ReaderMode;
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
  source?: 'custom' | 'embedded';
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
  authors?: string[];
  description?: string;
  coverUrl?: string;
  languages?: string[];
  sourceLanguage: string;
  requiresWholeChapterTranslation: boolean;
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

export interface ReaderNavigationEntry {
  id: string;
  title: string;
  level: number;
  chapterId?: string;
  parentId?: string;
}

export interface ReaderSegment {
  id: string;
  index: number;
  original: string;
  translated?: string;
}

export interface ReaderEpubDocumentSlice {
  sourcePath: string;
  content: string;
  inlineStyles: string[];
  stylesheetHrefs: string[];
  documentAttributes: Record<string, string>;
  bodyAttributes: Record<string, string>;
}

export interface ReaderEpubResource {
  path: string;
  mediaType: string;
  blob: Blob;
}

export interface ReaderEpubChapterContent {
  documents: ReaderEpubDocumentSlice[];
  resources: ReaderEpubResource[];
}

export interface ReaderChapterContent {
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  title: string;
  segments: ReaderSegment[];
  translationSource?: string;
  epub?: ReaderEpubChapterContent;
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
  getNavigation?(bookId: string): Promise<ReaderNavigationEntry[]>;
  getChapter(input: GetReaderChapterInput): Promise<ReaderChapterContent>;
  preloadChapter?(input: GetReaderChapterInput): void;
  invalidateChapter?(input: GetReaderChapterInput): void;
  invalidateBook?(bookId: string): void;
  getCapabilities(bookId: string): Promise<BookReadingCapabilities>;
}
