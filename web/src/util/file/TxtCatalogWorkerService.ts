import type {
  TxtDecodedDocument,
  TxtParseMode,
  TxtParseSummary,
} from '../../model/TxtCatalog';
import { analyzeTxtCatalog, createTxtImportPlan } from './TxtCatalogParser';
import { decodeTxtBuffer, normalizeTxtHeadingText } from './TxtDecode';
import type {
  TxtCatalogPreviewSnapshot,
  TxtCatalogWorkerRequest,
  TxtCatalogWorkerResponse,
} from './TxtCatalogWorkerProtocol';

export type TxtCatalogProgressReporter = (
  progress: Extract<TxtCatalogWorkerResponse, { type: 'progress' }>,
) => void;

const MAX_LINE_WINDOW = 500;
const MAX_SEARCH_RESULTS = 100;

export const createTxtCatalogWorkerService = (
  reportProgress: TxtCatalogProgressReporter = () => undefined,
) => {
  let document: TxtDecodedDocument | undefined;
  let fileName = '';
  let mode: TxtParseMode = 'balanced';
  let lastAnalysisSummary: TxtParseSummary | undefined;

  const requireDocument = () => {
    if (document === undefined) throw new Error('TXT 解析会话尚未初始化');
    return document;
  };

  const analyze = (requestId: number): TxtCatalogPreviewSnapshot => {
    const current = requireDocument();
    reportProgress({
      type: 'progress',
      requestId,
      progress: 0.65,
      stage: 'analyze',
      message: '正在分析目录结构',
    });
    const analysis = analyzeTxtCatalog(current, { mode });
    lastAnalysisSummary = analysis.summary;
    reportProgress({
      type: 'progress',
      requestId,
      progress: 1,
      stage: 'analyze',
      message: '目录分析完成',
    });
    return {
      fileName,
      mode,
      encoding: current.encoding,
      lineCount: current.lines.length,
      headings: analysis.headings,
      summary: analysis.summary,
      decodeCandidates: current.candidates,
    };
  };

  const initialize = (
    request: Extract<TxtCatalogWorkerRequest, { type: 'initialize' }>,
  ) => {
    reportProgress({
      type: 'progress',
      requestId: request.requestId,
      progress: 0.05,
      stage: 'decode',
      message: '正在检测文本编码',
    });
    document = decodeTxtBuffer(request.buffer);
    fileName = request.fileName;
    mode = request.mode;
    reportProgress({
      type: 'progress',
      requestId: request.requestId,
      progress: 0.5,
      stage: 'decode',
      message: `已使用 ${document.encoding} 解码`,
    });
    return analyze(request.requestId);
  };

  const handle = (request: TxtCatalogWorkerRequest) => {
    switch (request.type) {
      case 'initialize':
        return initialize(request);
      case 'reparse':
        mode = request.mode;
        return analyze(request.requestId);
      case 'get-lines': {
        const current = requireDocument();
        const startLine = Math.min(
          Math.max(Math.floor(request.startLine), 0),
          Math.max(current.lines.length - 1, 0),
        );
        const count = Math.min(
          Math.max(Math.floor(request.count), 1),
          MAX_LINE_WINDOW,
        );
        return {
          startLine,
          lines: current.lines.slice(startLine, startLine + count),
          totalLines: current.lines.length,
        };
      }
      case 'search': {
        const current = requireDocument();
        const query = normalizeTxtHeadingText(
          request.query,
        ).toLocaleLowerCase();
        if (query.length === 0) return { lineIndexes: [], wrapped: false };
        const startLine = Math.min(
          Math.max(Math.floor(request.startLine), 0),
          Math.max(current.lines.length - 1, 0),
        );
        const limit = Math.min(
          Math.max(Math.floor(request.limit), 1),
          MAX_SEARCH_RESULTS,
        );
        const matches: number[] = [];
        const scan = (from: number, to: number) => {
          for (
            let index = from;
            index < to && matches.length < limit;
            index += 1
          ) {
            if (
              current.lines[index]?.normalized
                .toLocaleLowerCase()
                .includes(query)
            ) {
              matches.push(index);
            }
          }
        };
        scan(startLine, current.lines.length);
        let wrapped = false;
        if (matches.length === 0 && startLine > 0) {
          wrapped = true;
          scan(0, startLine);
        }
        return { lineIndexes: matches, wrapped };
      }
      case 'build-plan': {
        const current = requireDocument();
        const summary = lastAnalysisSummary;
        if (summary === undefined) throw new Error('TXT 目录尚未完成自动分析');
        reportProgress({
          type: 'progress',
          requestId: request.requestId,
          progress: 0.2,
          stage: 'plan',
          message: '正在生成导入计划',
        });
        const plan = createTxtImportPlan(current, request.headings, {
          mode,
          candidateCount: summary.candidateCount,
          rejectedCount: summary.rejectedCount,
          learnedFormatCount: summary.learnedFormatCount,
        });
        reportProgress({
          type: 'progress',
          requestId: request.requestId,
          progress: 1,
          stage: 'plan',
          message: '导入计划已生成',
        });
        return plan;
      }
    }
  };

  return { handle };
};
