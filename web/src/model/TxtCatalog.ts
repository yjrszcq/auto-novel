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
