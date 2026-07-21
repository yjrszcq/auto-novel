import { BaiduApi } from '@/api';
import type { BaiduTranslateConfig } from '@/api';
import { RegexUtil } from '@/util';
import type { Logger, SegmentContext, SegmentTranslator } from './Common';
import { createBudgetSegmentor, createGlossaryWrapper } from './Common';

export class BaiduTranslator implements SegmentTranslator {
  id = <const>'baidu';
  log: (message: string) => void;
  constructor(
    log: Logger,
    private config: BaiduTranslateConfig,
  ) {
    this.log = log;
  }

  async init() {
    return this;
  }

  segmentor = createBudgetSegmentor(1800);

  async translate(
    seg: string[],
    { glossary, signal }: SegmentContext,
  ): Promise<string[]> {
    return createGlossaryWrapper(glossary)(seg, (seg) =>
      this.translateInner(seg, signal),
    );
  }

  async translateInner(seg: string[], signal?: AbortSignal): Promise<string[]> {
    const query = seg.join('\n');

    let from = 'jp';
    if (RegexUtil.hasHangulChars(query)) {
      from = 'kor';
    } else if (RegexUtil.hasKanaChars(query) || RegexUtil.hasHanzi(query)) {
      from = 'jp';
    } else if (RegexUtil.hasEnglishChars(query)) {
      from = 'en';
    }
    const translations = await BaiduApi.translate(query, from, this.config, {
      signal,
    });
    return translations.flatMap((translation) => translation.split(/\r?\n/));
  }
}

export namespace BaiduTranslator {
  export type Config = BaiduTranslateConfig;
  export const create = (log: Logger, config: Config) =>
    new BaiduTranslator(log, config).init();
}
