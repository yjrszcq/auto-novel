import { createOpenAiApi, OpenAiError } from '@/api';
import type { Glossary } from '@/model/Glossary';
import { normalizeFormatRetryCount } from '@/model/Translator';
import { delay, RegexUtil } from '@/util';

import type { Logger, SegmentContext, SegmentTranslator } from './Common';
import { createBudgetSegmentor } from './Common';
import { ProviderBackoff } from './ProviderBackoff';

type OpenAi = ReturnType<typeof createOpenAiApi>;
type FormatCorrection = { attempt: number; issue: string };

export class OpenAiTranslator implements SegmentTranslator {
  id = <const>'gpt';
  cacheIdentity: Readonly<Record<string, unknown>>;
  log: Logger;
  private api: OpenAi;
  private model: string;
  private backoff = new ProviderBackoff();

  constructor(log: Logger, { model, endpoint, key }: OpenAiTranslator.Config) {
    this.log = log;
    this.model = model;
    this.cacheIdentity = {
      endpoint,
      model,
      prompt: 'openai-light-novel-v1',
    };
    this.api = createOpenAiApi(endpoint, key);
  }

  segmentor = createBudgetSegmentor(1_500, 30, 4);

  async translate(seg: string[], context: SegmentContext): Promise<string[]> {
    const { glossary, signal } = context;
    const formatRetryCount = normalizeFormatRetryCount(
      context.formatRetryCount,
    );
    const log = context.logger ?? this.log;
    const logSegInfo = ({
      retry,
      binaryRange,
      lineNumber,
      suffix,
    }: {
      retry?: number;
      binaryRange?: [number, number];
      lineNumber?: [number, number];
      suffix?: string;
    }) => {
      const parts: string[] = [];
      if (retry !== undefined) {
        parts.push(`第${retry + 1}次`);
      }
      if (binaryRange !== undefined) {
        const [left, right] = binaryRange;
        if (right - left === 1) {
          parts.push(`翻译第${left + 1}行`);
        } else {
          parts.push(`翻译${left + 1}到${right}行`);
        }
      }
      if (lineNumber !== undefined) {
        const [input, output] = lineNumber;
        parts.push(`原文/输出：${input}/${output}行`);
      }
      if (suffix !== undefined) {
        parts.push(suffix);
      }
      log(parts.join('　'));
    };

    const requestBudget = {
      remaining: 1 + formatRetryCount + Math.max(4, seg.length * 4),
    };
    const translateValidLines = async (
      lines: string[],
      formatRetries: number,
      binaryRange?: [number, number],
    ): Promise<string[] | undefined> => {
      let correction: FormatCorrection | undefined;
      let formatFailureCount = 0;
      let providerFailureCount = 0;
      while (true) {
        if (requestBudget.remaining <= 0) {
          throw new Error('格式恢复请求预算已耗尽');
        }
        requestBudget.remaining -= 1;
        const result = await this.translateLines(
          lines,
          glossary,
          signal,
          correction,
        );

        if (!('answer' in result)) {
          logSegInfo({
            retry: binaryRange ? undefined : formatFailureCount,
            binaryRange,
            lineNumber: [lines.length, NaN],
          });
          if (providerFailureCount >= 2 && result.retryable) {
            throw Error('服务请求重试次数太多');
          }
          await this.onError(result, signal, log, providerFailureCount);
          providerFailureCount += 1;
          continue;
        }

        providerFailureCount = 0;
        logSegInfo({
          retry: binaryRange ? undefined : formatFailureCount,
          binaryRange,
          lineNumber: [lines.length, result.answer.length],
        });
        const issue =
          result.formatIssue ??
          (lines.length !== result.answer.length
            ? `输出行数不匹配，需要 ${lines.length} 行，实际 ${result.answer.length} 行`
            : !detectChinese(result.answer.join(' '))
              ? '输出语言不是中文'
              : undefined);
        if (issue === undefined) return result.answer;

        log(`输出错误：${issue}`);
        if (formatFailureCount >= formatRetries) return undefined;
        formatFailureCount += 1;
        correction = { attempt: formatFailureCount, issue };
        log(
          `保留完整分段进行第${formatFailureCount}次格式纠错重试（最多${formatRetries}次）`,
        );
      }
    };

    const completeResult = await translateValidLines(seg, formatRetryCount);
    if (completeResult !== undefined) return completeResult;
    if (seg.length === 1) throw Error('格式异常重试次数太多');
    log(`完整分段已重试${formatRetryCount}次，启动自然行边界二分翻译`);

    const binaryFormatRetries = Math.min(1, formatRetryCount);
    const maximumBinaryDepth = Math.ceil(Math.log2(seg.length)) + 1;
    const binaryTranslateSegment = async (
      left: number,
      right: number,
      depth: number,
    ): Promise<string[]> => {
      if (depth > maximumBinaryDepth) {
        throw new Error('二分恢复深度超出安全上限');
      }
      const result = await translateValidLines(
        seg.slice(left, right),
        binaryFormatRetries,
        [left, right],
      );
      if (result !== undefined) return result;

      if (right - left > 1) {
        log('失败，继续二分');
        const mid = Math.floor((left + right) / 2);
        const partLeft = await binaryTranslateSegment(left, mid, depth + 1);
        const partRight = await binaryTranslateSegment(mid, right, depth + 1);
        return partLeft.concat(partRight);
      } else {
        log('失败，无法继续，退出');
        throw Error('重试次数太多');
      }
    };

    const left = 0;
    const right = seg.length;
    const mid = Math.floor((left + right) / 2);
    const partLeft = await binaryTranslateSegment(left, mid, 1);
    const partRight = await binaryTranslateSegment(mid, right, 1);
    return partLeft.concat(partRight);
  }

  private async translateLines(
    lines: string[],
    glossary: Glossary,
    signal?: AbortSignal,
    correction?: FormatCorrection,
  ): Promise<
    | { message: string; retryable: boolean; retryAfterMs?: number }
    | { answer: string[]; formatIssue?: string }
  > {
    const parseAnswer = (answer: string) => {
      const lines = answer
        .replace(/^\s*```[^\n]*\n?/u, '')
        .replace(/\n?```\s*$/u, '')
        .split('\n')
        .filter((line) => line.trim().length > 0);
      const numbered = new Map<number, string>();
      let duplicateNumber = false;
      let numberedLineCount = 0;
      for (const line of lines) {
        const match = /^\s*#(\d+)\s*[:：]\s?(.*)$/u.exec(line);
        if (match === null) continue;
        numberedLineCount += 1;
        const lineNumber = Number(match[1]);
        if (numbered.has(lineNumber)) duplicateNumber = true;
        numbered.set(lineNumber, match[2].trim());
      }
      if (numberedLineCount === 0) return { answer: lines };
      if (
        !duplicateNumber &&
        numberedLineCount === lines.length &&
        numbered.size === lines.length &&
        Array.from({ length: lines.length }, (_, index) => index + 1).every(
          (lineNumber) => numbered.has(lineNumber),
        )
      ) {
        return {
          answer: Array.from({ length: lines.length }, (_, index) =>
            numbered.get(index + 1)!,
          ),
        };
      }
      return {
        answer: lines.map((line) =>
          line.replace(/^\s*#\d+\s*[:：]\s?/u, '').trim(),
        ),
        formatIssue: `编号不完整、重复或混有额外文本，需要严格输出 #1 到 #${lines.length}`,
      };
    };

    await this.waitForProviderCooldown(signal);
    return askApi(
      this.api,
      this.model,
      buildMessages(lines, glossary, correction),
      signal,
    )
      .then((it) => parseAnswer(it.answer))
      .catch((e: unknown) => {
        if (e instanceof OpenAiError) {
          if (e.code === 'rate_limit_exceeded' || e.status === 429) {
            return {
              message: '触发GPT限速',
              retryable: true,
              retryAfterMs: e.retryAfterMs,
            };
          }
          return {
            message: e.message,
            retryable:
              e.status === 408 ||
              e.status === 409 ||
              e.status === 425 ||
              (e.status !== undefined && e.status >= 500),
          };
        }
        throw e;
      });
  }

  private async onError(
    {
      message,
      retryable,
      retryAfterMs,
    }: {
      message: string;
      retryable: boolean;
      retryAfterMs?: number;
    },
    signal: AbortSignal | undefined,
    log: Logger,
    attempt: number,
  ) {
    if (!retryable) {
      log('发生不可重试错误：' + message);
      throw new Error(message);
    }
    const delayMs = this.backoff.reserveRetry(attempt, retryAfterMs);
    log(`发生可重试错误：${message}，暂停${formatDelay(delayMs)}`);
    await delay(delayMs, signal);
  }

  private async waitForProviderCooldown(signal?: AbortSignal) {
    while (this.backoff.remainingCooldown() > 0) {
      await delay(this.backoff.remainingCooldown(), signal);
    }
  }
}

const formatDelay = (delayMs: number) => {
  if (delayMs >= 60_000) return `${Math.round(delayMs / 60_000)}分钟`;
  if (delayMs >= 1_000) return `${(delayMs / 1_000).toFixed(1)}秒`;
  return `${delayMs}毫秒`;
};

export namespace OpenAiTranslator {
  export interface Config {
    model: string;
    endpoint: string;
    key: string;
  }
  export const create = (log: Logger, config: Config) =>
    new OpenAiTranslator(log, config);
}

const askApi = (
  api: OpenAi,
  model: string,
  messages: ['user' | 'assistant', string][],
  signal?: AbortSignal,
): Promise<{ answer: string }> =>
  api
    .createChatCompletionsStream(
      {
        messages: messages.map(([role, content]) => ({ content, role })),
        model,
        stream: true,
      },
      { signal },
    )
    .then((completionStream) => {
      const answer = Array.from(completionStream)
        .map((chunk) => chunk.choices[0]?.delta.content)
        .filter((content) => typeof content === 'string')
        .join('');
      return { answer };
    });

const buildMessages = (
  lines: string[],
  glossary: Glossary,
  correction?: FormatCorrection,
): ['user' | 'assistant', string][] => {
  const buildPrompt = () => {
    const parts = [
      '请你作为一个轻小说翻译者，将下面的轻小说翻译成简体中文。要求翻译准确，译文流畅，尽量保持原文写作风格。要求人名和专有名词也要翻译成中文。既不要漏掉任何一句，也不要增加额外的说明。注意保持换行格式，译文的行数必须要和原文相等。',
    ];

    if (correction !== undefined) {
      parts.push(
        `上一次输出未通过格式校验：${correction.issue}。这是第${correction.attempt}次纠错重试。`,
        `只输出 #1 到 #${lines.length} 的译文，每个编号必须恰好出现一次并各占一行；禁止代码块、前言、解释或总结。`,
      );
    }

    const matchedWordPairs: [string, string][] = [];
    for (const jp in glossary) {
      for (const line of lines) {
        if (line.includes(jp)) {
          matchedWordPairs.push([jp, glossary[jp]]);
          break;
        }
      }
    }
    if (matchedWordPairs.length > 0) {
      parts.push('翻译的时候参考下面的术语表：');
      for (const [jp, zh] of matchedWordPairs) {
        parts.push(`${jp} => ${zh}`);
      }
    }

    parts.push('小说原文如下，注意要保留每一段开头的编号：');
    lines.forEach((line, i) => parts.push(`#${i + 1}:${line}`));
    if (lines.length === 1) parts.push('原文到此为止'); // 防止乱编
    return parts.join('\n');
  };

  return [['user', buildPrompt()]];
};

const detectChinese = (text: string) => {
  const reChinese =
    /[:|#| |0-9|\u4e00-\u9fa5|\u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3008|\u3009|\u3010|\u3011|\u300e|\u300f|\u300c|\u300d|\ufe43|\ufe44|\u3014|\u3015|\u2026|\u2014|\uff5e|\ufe4f|\uffe5]/;

  // not calculate url
  text = text.replace(/(https?:\/\/[^\s]+)/g, '');

  let zh = 0,
    jp = 0,
    en = 0;
  for (const c of text) {
    if (reChinese.test(c)) {
      zh++;
    } else if (RegexUtil.hasKanaChars(c)) {
      jp++;
    } else if (RegexUtil.hasEnglishChars(c)) {
      en++;
    }
  }
  const pZh = zh / text.length,
    pJp = jp / text.length,
    pEn = en / text.length;
  return pZh > 0.75 || (pZh > pJp && pZh > pEn * 2 && pJp < 0.1);
};
