import { createOpenAiApi } from '@/api';
import type { Glossary } from '@/model/Glossary';

import type { Logger, SegmentContext, SegmentTranslator } from './Common';
import { createLengthSegmentor } from './Common';

export class SakuraTranslator implements SegmentTranslator {
  id = <const>'sakura';
  log: (message: string, detail?: string[]) => void;
  private api;
  version: string = '0.9';
  model?: {
    id: string;
  };
  segmentor = createLengthSegmentor(500);
  segLength = 500;
  prevSegLength = 500;

  constructor(
    log: Logger,
    { endpoint, segLength, prevSegLength }: SakuraTranslator.Config,
  ) {
    this.log = log;
    this.api = createOpenAiApi(endpoint, 'no-key');
    if (segLength !== undefined) {
      this.segmentor = createLengthSegmentor(segLength);
      this.segLength = segLength;
    }
    if (prevSegLength !== undefined) {
      this.prevSegLength = prevSegLength;
    }
  }

  async init() {
    this.model = (await this.detectModel()) as typeof this.model;
    const id = this.model?.id;
    if (id !== undefined) {
      if (id.includes('0.8')) this.version = '0.8';
      else if (id.includes('0.9')) this.version = '0.9';
      else if (id.includes('0.10')) this.version = '0.10';
      else if (id.includes('1.0')) this.version = '1.0';
    }
    console.log('Model:');
    console.log(this.model);
    return this;
  }

  async translate(
    seg: string[],
    context: SegmentContext,
  ): Promise<string[]> {
    const { glossary, prevSegs, signal } = context;
    const log = context.logger ?? this.log;
    const concatedSeg = seg.join('\n');
    const prevSegCount = -Math.ceil(this.prevSegLength / this.segLength);

    const concatedPrevSeg =
      prevSegCount === 0 ? '' : prevSegs.slice(prevSegCount).flat().join('\n');

    // 正常翻译
    let retry = 1;
    while (retry < 3) {
      const { text, hasDegradation } = await this.createChatCompletions(
        concatedSeg,
        glossary,
        concatedPrevSeg,
        signal,
        retry > 1,
      );
      const splitText = text.replaceAll('<|im_end|>', '').split('\n');

      const parts: string[] = [`第${retry}次`];
      const linesNotMatched = seg.length !== splitText.length;
      if (hasDegradation) {
        parts.push('退化');
      } else if (linesNotMatched) {
        parts.push('行数不匹配');
      } else {
        parts.push('成功');
      }
      const detail = [seg.join('\n'), text];
      log(parts.join('　'), detail);

      if (!hasDegradation && !linesNotMatched) {
        return splitText;
      } else {
        retry += 1;
      }
    }

    // 逐行翻译
    {
      log('逐行翻译');
      let degradationLineCount = 0;
      const resultPerLine = [];
      for (const line of seg) {
        const { text, hasDegradation } = await this.createChatCompletions(
          line,
          glossary,
          [concatedPrevSeg, ...resultPerLine].join('\n'),
          signal,
          true,
        );
        if (hasDegradation) {
          degradationLineCount += 1;
          log(`单行退化${degradationLineCount}次`, [line, text]);
          if (degradationLineCount >= 2) {
            throw Error('单个分段有2行退化，Sakura翻译器可能存在异常');
          } else {
            resultPerLine.push(line);
          }
        } else {
          resultPerLine.push(text.replaceAll('<|im_end|>', ''));
        }
      }
      return resultPerLine;
    }
  }

  private async detectModel() {
    const modelsPage = await this.api
      .listModels({
        headers: {
          'ngrok-skip-browser-warning': '69420',
        },
      })
      .catch((e) => {
        this.log(`获取模型数据失败：${e}`);
      });
    const model = modelsPage?.data[0];
    if (model === undefined) {
      return undefined;
    }
    return { id: model.id.replace(/(.gguf)$/, '') };
  }

  private async createChatCompletions(
    text: string,
    glossary: Glossary,
    prevText: string,
    signal?: AbortSignal,
    hasDegradation?: boolean,
  ) {
    const messages: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[] = [];

    const system = (content: string) => {
      messages.push({ role: 'system', content });
    };
    const user = (content: string) => {
      messages.push({ role: 'user', content });
    };
    const assistant = (content: string) => {
      messages.push({ role: 'assistant', content });
    };

    // 全角数字转换成半角数字
    text = text.replace(/[\uff10-\uff19]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    );

    if (this.version === '1.0') {
      system(
        '你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。',
      );
      if (prevText !== '') {
        assistant(prevText);
      }

      if (Object.keys(glossary).length === 0) {
        user(`将下面的日文文本翻译成中文：${text}`);
      } else {
        const glossaryHint = Object.entries(glossary)
          .map(([wordJp, wordZh]) => `${wordJp}->${wordZh}`)
          .join('\n');
        user(
          `根据以下术语表（可以为空）：\n${glossaryHint}\n` +
            `将下面的日文文本根据对应关系和备注翻译成中文：${text}`,
        );
      }
    } else if (this.version === '0.10') {
      system(
        '你是一个轻小说翻译模型，可以流畅通顺地使用给定的术语表以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，注意不要混淆使役态和被动态的主语和宾语，不要擅自添加原文中没有的代词，也不要擅自增加或减少换行。',
      );
      if (prevText !== '') {
        assistant(prevText);
      }

      const glossaryHint = Object.entries(glossary)
        .map(([wordJp, wordZh]) => `${wordJp}->${wordZh}`)
        .join('\n');

      user(
        `根据以下术语表（可以为空）：\n${glossaryHint}\n\n将下面的日文文本根据上述术语表的对应关系和备注翻译成中文：${text}`,
      );
    } else {
      system(
        '你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。',
      );
      if (prevText !== '') {
        assistant(prevText);
      }

      // 替换术语表词汇
      for (const wordJp of Object.keys(glossary).sort(
        (a, b) => b.length - a.length,
      )) {
        const wordZh = glossary[wordJp];
        text = text.replaceAll(wordJp, wordZh);
      }

      user(`将下面的日文文本翻译成中文：${text}`);
    }

    const maxNewToken = Math.max(Math.ceil(text.length * 1.7), 100);
    const completion = await this.api.createChatCompletions(
      {
        model: '',
        messages,
        temperature: 0.1,
        top_p: 0.3,
        max_tokens: maxNewToken,
        frequency_penalty: hasDegradation ? 0.2 : 0.0,
      },
      {
        signal,
        timeout: false,
      },
    );

    return {
      text: completion.choices[0].message.content!,
      hasDegradation: completion.usage.completion_tokens >= maxNewToken,
    };
  }
}

export namespace SakuraTranslator {
  export interface Config {
    endpoint: string;
    segLength?: number;
    prevSegLength?: number;
  }
  export const create = (log: Logger, config: Config) =>
    new SakuraTranslator(log, config).init();
}
