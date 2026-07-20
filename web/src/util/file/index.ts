import { Epub } from './epub';
import { Srt } from './srt';
import { Txt } from './txt';
import { StandardNovel } from './standard';

export { Epub, Srt, Txt, StandardNovel };
export type { StandardChapter, StandardTxtOptions } from './standard';
export {
  buildTxtSourceLines,
  decodeTxtBuffer,
  decodeTxtText,
  normalizeTxtHeadingText,
} from './TxtDecode';
export {
  collectExplicitTxtHeadingMatches,
  matchTxtHeadingRule,
  parseTxtHeadingNumber,
  stripTxtHeadingDecoration,
} from './TxtHeadingRules';
export type { TxtHeadingKind, TxtHeadingRuleMatch } from './TxtHeadingRules';
export {
  analyzeTxtCatalog,
  createTxtImportPlan,
  parseTxtCatalog,
  reconstructTxtImportPlan,
} from './TxtCatalogParser';
export type { ParseTxtCatalogOptions } from './TxtCatalogParser';
export { TxtCatalogDraftEditor } from './TxtCatalogDraftEditor';
export type { TxtCatalogDraftValidation } from './TxtCatalogDraftEditor';
export type {
  TxtCatalogLineWindow,
  TxtCatalogPreviewSnapshot,
  TxtCatalogSearchResult,
  TxtCatalogWorkerRequest,
  TxtCatalogWorkerResponse,
  TxtCatalogWorkerResult,
} from './TxtCatalogWorkerProtocol';
export {
  createTxtCatalogSession,
  getStoredTxtParseMode,
  setStoredTxtParseMode,
  TXT_PARSE_MODE_STORAGE_KEY,
} from './TxtCatalogWorkerSession';
export type {
  TxtCatalogProgress,
  TxtCatalogSession,
} from './TxtCatalogWorkerSession';
export type {
  TxtCatalogAnalysis,
  TxtCatalogNode,
  TxtDecodedDocument,
  TxtDecodeCandidate,
  TxtEncoding,
  TxtHeadingDraft,
  TxtImportPlan,
  TxtParseMode,
  TxtParseSummary,
  TxtPlannedChapter,
  TxtSourceLine,
} from '../../model/TxtCatalog';
export type ParsedFile = Epub | Srt | Txt;

export const parseFile = async (
  file: File,
  allowExts = ['epub', 'txt', 'srt'],
) => {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === undefined) throw '无法获取文件后缀名';
  if (allowExts.includes(ext)) {
    try {
      if (ext === 'txt') {
        return await Txt.fromFile(file);
      } else if (ext === 'epub') {
        return await Epub.fromFile(file);
      } else if (ext === 'srt') {
        return await Srt.fromFile(file);
      }
    } catch (e) {
      throw `无法解析${ext.toUpperCase()}文件，因为:${e}`;
    }
  }
  throw '不支持的文件格式';
};
