import type {
  TxtDecodeCandidate,
  TxtHeadingDraft,
  TxtImportPlan,
  TxtParseMode,
  TxtParseSummary,
  TxtSourceLine,
} from '../../model/TxtCatalog';

interface TxtCatalogWorkerRequestBase {
  requestId: number;
}

export type TxtCatalogWorkerRequest =
  | (TxtCatalogWorkerRequestBase & {
      type: 'initialize';
      fileName: string;
      buffer: ArrayBuffer;
      mode: TxtParseMode;
    })
  | (TxtCatalogWorkerRequestBase & {
      type: 'reparse';
      mode: TxtParseMode;
    })
  | (TxtCatalogWorkerRequestBase & {
      type: 'get-lines';
      startLine: number;
      count: number;
    })
  | (TxtCatalogWorkerRequestBase & {
      type: 'search';
      query: string;
      startLine: number;
      limit: number;
      direction: 1 | -1;
    })
  | (TxtCatalogWorkerRequestBase & {
      type: 'build-plan';
      headings: TxtHeadingDraft[];
    });

export interface TxtCatalogPreviewSnapshot {
  fileName: string;
  mode: TxtParseMode;
  encoding: TxtParseSummary['encoding'];
  lineCount: number;
  headings: TxtHeadingDraft[];
  summary: TxtParseSummary;
  decodeCandidates: TxtDecodeCandidate[];
}

export interface TxtCatalogLineWindow {
  startLine: number;
  lines: TxtSourceLine[];
  totalLines: number;
}

export interface TxtCatalogSearchResult {
  lineIndexes: number[];
  wrapped: boolean;
}

export type TxtCatalogWorkerResult =
  | TxtCatalogPreviewSnapshot
  | TxtCatalogLineWindow
  | TxtCatalogSearchResult
  | TxtImportPlan;

export type TxtCatalogWorkerResponse =
  | {
      type: 'progress';
      requestId: number;
      progress: number;
      stage: 'decode' | 'analyze' | 'plan';
      message: string;
    }
  | {
      type: 'result';
      requestId: number;
      result: TxtCatalogWorkerResult;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };
