export type TxtParseMode = 'strict' | 'balanced' | 'loose';

export type TxtEncoding =
  'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5' | 'shift_jis';

export interface TxtSourceLine {
  /** Zero-based line index in the normalized source text. */
  lineIndex: number;
  /** The original line content. Line endings are stored separately. */
  raw: string;
  /** A normalized copy used only for catalog detection. */
  normalized: string;
  /** Inclusive UTF-16 character offset in the normalized source text. */
  startOffset: number;
  /** Exclusive UTF-16 character offset, excluding the line ending. */
  endOffset: number;
}

export interface TxtHeadingDraft {
  /** Zero-based source line index. */
  lineIndex: number;
  title: string;
  level: number;
  rule: string;
  confidence: number;
  isManual: boolean;
  reasons?: string[];
}

export interface TxtDecodeCandidate {
  encoding: TxtEncoding;
  score: number;
}

export interface TxtDecodedDocument {
  encoding: TxtEncoding;
  text: string;
  lines: TxtSourceLine[];
  candidates: TxtDecodeCandidate[];
}

export interface TxtPlannedChapter {
  /** Deterministic plan-local identifier; persisted IDs are generated later. */
  planId: string;
  title: string;
  level: number;
  parentChapterIndex?: number;
  headingLineIndex?: number;
  sourceStartLine: number;
  sourceEndLine: number;
  content: string;
  isPreamble?: boolean;
  isFallback?: boolean;
}

export interface TxtCatalogNode {
  chapterIndex: number;
  title: string;
  level: number;
  children: TxtCatalogNode[];
}

export interface TxtParseSummary {
  encoding: TxtEncoding;
  mode: TxtParseMode;
  lineCount: number;
  candidateCount: number;
  headingCount: number;
  rejectedCount: number;
  learnedFormatCount: number;
  usedFallback: boolean;
  averageConfidence: number;
}

export interface TxtImportPlan {
  encoding: TxtEncoding;
  mode: TxtParseMode;
  chapters: TxtPlannedChapter[];
  navigation: TxtCatalogNode[];
  headings: TxtHeadingDraft[];
  summary: TxtParseSummary;
}

export interface TxtCatalogAnalysis {
  headings: TxtHeadingDraft[];
  summary: TxtParseSummary;
}
