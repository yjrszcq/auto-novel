import type { Glossary } from '@/model/Glossary';
import type { TranslatorId } from '@/model/Translator';
import { normalizeTranslationConcurrency } from '@/model/Translator';

import { BaiduTranslator } from './TranslatorBaidu';
import { OpenAiTranslator } from './TranslatorOpenAi';
import { SakuraTranslator } from './TranslatorSakura';
import { YoudaoTranslator } from './TranslatorYoudao';
import type { Logger, SegmentCache, SegmentTranslator } from './Common';
import { createSegIndexedDbCache } from './Common';
import { RegexUtil } from '@/util';
import type { ConcurrencyLimiter } from './Concurrency';
import { normalizeConcurrencyLimit, runWithConcurrency } from './Concurrency';

const glossariesEqual = (left: Glossary, right: Glossary) => {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
};

export type SegmentProgressInfo = {
  chapter?: { index?: number; total?: number; id?: string };
  segmentIndex: number;
  segmentTotal: number;
  workerId?: string;
  status: 'start' | 'success' | 'complete' | 'failed';
};

export type TranslationSegmentAssignment = {
  chapter?: { index?: number; total?: number; id?: string };
  segmentIndex: number;
  segmentTotal: number;
};

export type SegmentDispatcher = (request: {
  assignment: TranslationSegmentAssignment;
  signal: AbortSignal;
  execute: (translator: Translator, signal: AbortSignal) => Promise<string[]>;
}) => Promise<{ output: string[]; workerId?: string }>;

export type TranslatorConfig =
  | ({ id: 'baidu' } & BaiduTranslator.Config)
  | ({ id: 'youdao' } & YoudaoTranslator.Config)
  | ({ id: 'gpt' } & OpenAiTranslator.Config)
  | ({ id: 'sakura' } & SakuraTranslator.Config);

type TranslateRuntimeOptions = {
  concurrency?: number;
  requestLimiter?: ConcurrencyLimiter;
  segmentDispatcher?: SegmentDispatcher;
  chapter?: {
    index: number;
    total: number;
    id?: string;
  };
  onSegmentProgress?: (info: SegmentProgressInfo) => void;
};

export class Translator {
  id: TranslatorId;
  log: (message: string) => void;
  segTranslator: SegmentTranslator;
  segCache?: SegmentCache;

  constructor(
    segTranslator: SegmentTranslator,
    segCache?: SegmentCache,
    log?: (message: string) => void,
  ) {
    this.id = segTranslator.id;
    this.segTranslator = segTranslator;
    this.segCache = segCache;
    this.log = log ?? (() => {});
  }

  sakuraModel() {
    if (this.segTranslator instanceof SakuraTranslator) {
      return this.segTranslator.model?.id ?? '未知';
    } else {
      return '';
    }
  }

  sakuraProfile() {
    if (this.segTranslator instanceof SakuraTranslator) {
      return this.segTranslator.profile();
    }
    return undefined;
  }

  async translatePlain(textJp: string) {
    const result = await this.translate(textJp.split('\n'));
    return result.join('\n');
  }

  async translate(
    textJp: string[],
    context?: {
      glossary?: Glossary;
      oldTextZh?: string[] | undefined;
      oldGlossary?: Glossary;
      force?: boolean;
      signal?: AbortSignal;
      formatRetryCount?: number;
    },
    options?: TranslateRuntimeOptions,
  ): Promise<string[]> {
    const oldTextZh = context?.oldTextZh;
    const textZh = await emptyLineFilterWrapper(
      textJp,
      oldTextZh,
      async (textJp, oldTextZh) => {
        if (textJp.length === 0) return [];

        const segs = this.segTranslator.segmentor(textJp, oldTextZh);
        const size = segs.length;
        const segsZh: Array<string[] | undefined> = new Array(size);
        const usesSequentialContext =
          this.segTranslator instanceof SakuraTranslator;
        const sequentialContext = Array.from(
          { length: textJp.length },
          () => '',
        );
        let sequentialContextLength = 0;
        const concurrency = usesSequentialContext
          ? 1
          : options?.segmentDispatcher
            ? normalizeConcurrencyLimit(options.concurrency)
            : normalizeTranslationConcurrency(options?.concurrency);

        options?.onSegmentProgress?.({
          chapter: options?.chapter,
          segmentIndex: 0,
          segmentTotal: size,
          status: 'start',
        });

        await runWithConcurrency(
          Array.from({ length: size }, (_, i) => i),
          concurrency,
          async (segIndex, _index, workerSignal) => {
            const [segJp, oldSegZh, sourceLineIndexes] = segs[segIndex];
            const logLabel = buildLogLabel(
              options?.chapter,
              segIndex + 1,
              size,
            );
            const translateSegment = (
              translator: Translator,
              signal: AbortSignal,
            ) => {
              const logger = (message: string, detail?: string[]) =>
                translator.log(`${logLabel} ${message}`, detail);
              return translator.translateSeg(
                segJp,
                {
                  ...context,
                  signal,
                  prevSegs:
                    usesSequentialContext && sequentialContextLength > 0
                      ? [sequentialContext.slice(0, sequentialContextLength)]
                      : [],
                  oldSegZh,
                  logger,
                  formatRetryCount: context?.formatRetryCount,
                },
                logLabel,
              );
            };
            let workerId: string | undefined;
            let segZh: string[];
            if (options?.segmentDispatcher) {
              const dispatched = await options.segmentDispatcher({
                assignment: {
                  chapter: options.chapter,
                  segmentIndex: segIndex + 1,
                  segmentTotal: size,
                },
                signal: workerSignal,
                execute: translateSegment,
              });
              segZh = dispatched.output;
              workerId = dispatched.workerId;
            } else {
              const execute = () => translateSegment(this, workerSignal);
              segZh = options?.requestLimiter
                ? await options.requestLimiter.run(execute, workerSignal)
                : await execute();
            }
            if (segJp.length !== segZh.length) {
              throw new Error('翻译结果行数不匹配。不应当出现，请反馈给站长。');
            }
            segsZh[segIndex] = segZh;
            if (usesSequentialContext) {
              segZh.forEach((part, partIndex) => {
                const sourceLineIndex = sourceLineIndexes[partIndex];
                sequentialContext[sourceLineIndex] += part;
                sequentialContextLength = Math.max(
                  sequentialContextLength,
                  sourceLineIndex + 1,
                );
              });
            }
            options?.onSegmentProgress?.({
              chapter: options?.chapter,
              segmentIndex: segIndex + 1,
              segmentTotal: size,
              workerId,
              status: 'success',
            });
          },
          context?.signal,
        );

        const reconstructed = Array.from({ length: textJp.length }, () => '');
        segs.forEach(([, , sourceLineIndexes], segmentIndex) => {
          const output = segsZh[segmentIndex];
          if (output === undefined) return;
          output.forEach((part, partIndex) => {
            reconstructed[sourceLineIndexes[partIndex]] += part;
          });
        });
        return reconstructed;
      },
    );
    return textZh;
  }

  private async translateSeg(
    seg: string[],
    {
      logger,
      glossary,
      oldSegZh,
      oldGlossary,
      prevSegs,
      force,
      signal,
      formatRetryCount,
    }: {
      logger: Logger;
      glossary?: Glossary;
      oldSegZh?: string[];
      oldGlossary?: Glossary;
      prevSegs: string[][];
      force?: boolean;
      signal?: AbortSignal;
      formatRetryCount?: number;
    },
    logLabel: string,
  ) {
    glossary = glossary || {};
    oldGlossary = oldGlossary || {};

    const log = (message: string, detail?: string[]) =>
      logger(`${message}`, detail);

    // 检测分段是否需要重新翻译
    const segGlossary = filterGlossary(glossary, seg);
    if (!force && oldSegZh !== undefined) {
      const segOldGlossary = filterGlossary(oldGlossary, seg);
      if (glossariesEqual(segGlossary, segOldGlossary)) {
        log('术语表无变化，无需翻译');
        return oldSegZh;
      }
    }

    // 检测是否有分段缓存存在
    let cacheKey: string | undefined;
    if (this.segCache) {
      try {
        const extra = {
          glossary: segGlossary,
          prevSegs:
            this.segTranslator instanceof SakuraTranslator
              ? this.segTranslator.selectPreviousContext(prevSegs)
              : undefined,
          translator: this.segTranslator.cacheIdentity,
        };
        cacheKey = this.segCache.cacheKey(seg, extra);
        if (!force && this.segCache.getOrCreate === undefined) {
          const cachedSegOutput = await this.segCache.get(cacheKey);
          if (cachedSegOutput && cachedSegOutput.length === seg.length) {
            log('从缓存恢复');
            return cachedSegOutput;
          }
        }
      } catch {
        this.segCache.record?.('fault');
        log('缓存读取失败，已继续使用在线翻译');
      }
    }

    const translateAndNormalize = async () => {
      const segOutput = await this.segTranslator.translate(seg, {
        glossary: segGlossary,
        prevSegs,
        signal,
        formatRetryCount,
        logger: (msg, detail) => this.log(`${logLabel} ${msg}`, detail),
      });
      if (segOutput.length !== seg.length) {
        throw new Error('分段翻译结果行数不匹配，请反馈给站长');
      }

      // 翻译器通常不会保留行首空格，尝试手动恢复
      for (let i = 0; i < seg.length; i++) {
        const lineJp = seg[i];
        if (lineJp.trim().length === 0) continue;
        const space = RegexUtil.getLeadingSpaces(lineJp);
        segOutput[i] = space + segOutput[i].trimStart();
      }
      return segOutput;
    };

    if (
      !force &&
      cacheKey !== undefined &&
      this.segCache?.getOrCreate !== undefined
    ) {
      const result = await this.segCache.getOrCreate(
        cacheKey,
        translateAndNormalize,
        (output) => output.length === seg.length,
      );
      if (result.source === 'cache') log('从缓存恢复');
      if (result.source === 'deduplicated') log('复用进行中的相同翻译');
      if (result.cacheFault) log('缓存访问失败，已继续使用在线翻译');
      return result.output;
    }

    if (force) this.segCache?.record?.('provider');
    const segOutput = await translateAndNormalize();

    // 保存分段缓存
    if (this.segCache && cacheKey !== undefined) {
      try {
        await this.segCache.save(cacheKey, segOutput);
      } catch {
        this.segCache.record?.('fault');
        log('缓存保存失败，在线译文仍已保留');
      }
    }

    return segOutput;
  }
}

export namespace Translator {
  const createSegmentTranslator = async (
    log: Logger,
    config: TranslatorConfig,
  ): Promise<SegmentTranslator> => {
    if (config.id === 'baidu') {
      return BaiduTranslator.create(log, config);
    } else if (config.id === 'youdao') {
      return YoudaoTranslator.create(log, config);
    } else if (config.id === 'gpt') {
      return OpenAiTranslator.create(log, config);
    } else {
      return SakuraTranslator.create(log, config);
    }
  };

  export const create = async (
    config: TranslatorConfig,
    cache: boolean = false,
    log?: Logger,
  ) => {
    log = log ?? (() => {});
    const segTranslator = await createSegmentTranslator(
      (message, detail) => log?.('　' + message, detail),
      config,
    );
    let segCache: SegmentCache | undefined = undefined;
    if (cache) {
      if (config.id === 'gpt') {
        segCache = await createSegIndexedDbCache('gpt-seg-cache');
      } else if (config.id === 'sakura') {
        segCache = await createSegIndexedDbCache('sakura-seg-cache');
      }
    }
    return new Translator(segTranslator, segCache, log);
  };
}

const filterGlossary = (glossary: Glossary, text: string[]) => {
  const filteredGlossary: Glossary = {};
  for (const wordJp in glossary) {
    if (text.some((it) => it.includes(wordJp))) {
      filteredGlossary[wordJp] = glossary[wordJp];
    }
  }
  return filteredGlossary;
};

const emptyLineFilterWrapper = async (
  textJp: string[],
  oldTextZh: string[] | undefined,
  callback: (
    textJp: string[],
    oldTextZh: string[] | undefined,
  ) => Promise<string[]>,
) => {
  const textJpFiltered: string[] = [];
  const oldTextZhFiltered: string[] = [];
  for (let i = 0; i < textJp.length; i++) {
    const lineJp = textJp[i].replace(/\r?\n|\r/g, '');
    if (!(lineJp.trim() === '' || lineJp.startsWith('<图片>'))) {
      textJpFiltered.push(lineJp);
      if (oldTextZh !== undefined) {
        const lineZh = oldTextZh[i];
        oldTextZhFiltered.push(lineZh);
      }
    }
  }

  const textZh = await callback(
    textJpFiltered,
    oldTextZh === undefined ? undefined : oldTextZhFiltered,
  );

  const recoveredTextZh: string[] = [];
  for (const lineJp of textJp) {
    const realLineJp = lineJp.replace(/\r?\n|\r/g, '');
    if (realLineJp.trim() === '' || realLineJp.startsWith('<图片>')) {
      recoveredTextZh.push(lineJp);
    } else {
      const outputLine = textZh.shift();
      recoveredTextZh.push(outputLine!);
    }
  }
  return recoveredTextZh;
};

const buildLogLabel = (
  chapter:
    | {
        index: number;
        total: number;
      }
    | undefined,
  segmentIndex: number,
  segmentTotal: number,
) => {
  const chapterPart = chapter
    ? `章节${chapter.index}/${chapter.total}`
    : '章节?/?';
  const segmentPart = `分段${segmentIndex}/${segmentTotal}`;
  return `${chapterPart}  ${segmentPart}`;
};
