import { createOpenAiApi, OpenAiError } from '@/api';
import type { Glossary } from '@/model/Glossary';
import { delay, RegexUtil } from '@/util';

import type { Logger, SegmentContext, SegmentTranslator } from './Common';
import { createBudgetSegmentor } from './Common';
import { ProviderBackoff } from './ProviderBackoff';

type OpenAi = ReturnType<typeof createOpenAiApi>;

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

    let retry = 0;
    let lineNumberMismatchCount = 0;
    while (true) {
      const result = await this.translateLines(seg, glossary, signal);

      if ('answer' in result) {
        const isChinese = detectChinese(result.answer.join(' '));
        logSegInfo({ retry, lineNumber: [seg.length, result.answer.length] });

        if (seg.length !== result.answer.length) {
          lineNumberMismatchCount += 1;
          log('输出错误：输出行数不匹配');
          if (seg.length > 1) {
            log('直接拆分异常分段，避免重复请求相同内容');
            break;
          }
        } else if (!isChinese) {
          log('输出错误：输出语言不是中文');
        } else {
          return result.answer;
        }
      } else {
        logSegInfo({ retry, lineNumber: [seg.length, NaN] });
        if (retry >= 2 && result.retryable) throw Error('重试次数太多');
        await this.onError(result, signal, log, retry);
      }

      retry += 1;
      if (retry >= 3) {
        if (lineNumberMismatchCount === 3 && seg.length > 1) {
          log('连续三次行数不匹配，启动二分翻译');
          break;
        } else {
          throw Error('重试次数太多');
        }
      }
    }

    const binaryTranslateSegment = async (
      left: number,
      right: number,
    ): Promise<string[]> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await this.translateLines(
          seg.slice(left, right),
          glossary,
          signal,
        );
        if ('answer' in result) {
          const isChinese = detectChinese(result.answer.join(' '));
          logSegInfo({
            binaryRange: [left, right],
            lineNumber: [right - left, result.answer.length],
          });
          if (right - left === result.answer.length && isChinese) {
            return result.answer;
          }
          if (right - left !== result.answer.length) break;
        } else {
          logSegInfo({
            binaryRange: [left, right],
            lineNumber: [right - left, NaN],
          });
          if (attempt >= 2 && result.retryable) throw Error('重试次数太多');
          await this.onError(result, signal, log, attempt);
        }
      }

      if (right - left > 1) {
        log('失败，继续二分');
        const mid = Math.floor((left + right) / 2);
        const partLeft = await binaryTranslateSegment(left, mid);
        const partRight = await binaryTranslateSegment(mid, right);
        return partLeft.concat(partRight);
      } else {
        log('失败，无法继续，退出');
        throw Error('重试次数太多');
      }
    };

    const left = 0;
    const right = seg.length;
    const mid = Math.floor((left + right) / 2);
    const partLeft = await binaryTranslateSegment(left, mid);
    const partRight = await binaryTranslateSegment(mid, right);
    return partLeft.concat(partRight);
  }

  private async translateLines(
    lines: string[],
    glossary: Glossary,
    signal?: AbortSignal,
  ): Promise<
    | { message: string; retryable: boolean; retryAfterMs?: number }
    | { answer: string[] }
  > {
    const parseAnswer = (answer: string) => {
      const lines = answer
        .replace(/^\s*```[^\n]*\n?/u, '')
        .replace(/\n?```\s*$/u, '')
        .split('\n')
        .filter((line) => line.trim().length > 0);
      const numbered = new Map<number, string>();
      let duplicateNumber = false;
      for (const line of lines) {
        const match = /^\s*#(\d+)\s*[:：]\s?(.*)$/u.exec(line);
        if (match === null) continue;
        const lineNumber = Number(match[1]);
        if (numbered.has(lineNumber)) duplicateNumber = true;
        numbered.set(lineNumber, match[2].trim());
      }
      if (
        !duplicateNumber &&
        numbered.size === lines.length &&
        Array.from({ length: lines.length }, (_, index) => index + 1).every(
          (lineNumber) => numbered.has(lineNumber),
        )
      ) {
        return Array.from({ length: lines.length }, (_, index) =>
          numbered.get(index + 1)!,
        );
      }
      return lines.map((line) =>
        line.replace(/^\s*#\d+\s*[:：]\s?/u, '').trim(),
      );
    };

    await this.waitForProviderCooldown(signal);
    return askApi(this.api, this.model, buildMessages(lines, glossary), signal)
      .then((it) => ({ answer: parseAnswer(it.answer) }))
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
): ['user' | 'assistant', string][] => {
  const buildPrompt = () => {
    const parts = [
      '请你作为一个轻小说翻译者，将下面的轻小说翻译成简体中文。要求翻译准确，译文流畅，尽量保持原文写作风格。要求人名和专有名词也要翻译成中文。既不要漏掉任何一句，也不要增加额外的说明。注意保持换行格式，译文的行数必须要和原文相等。',
    ];

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
