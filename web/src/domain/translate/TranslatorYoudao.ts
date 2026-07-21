import { YoudaoApi } from '@/api';
import type { YoudaoTranslateConfig } from '@/api';
import { RegexUtil } from '@/util';
import type { Logger, SegmentContext, SegmentTranslator } from './Common';
import { createBudgetSegmentor, createGlossaryWrapper } from './Common';

export class YoudaoTranslator implements SegmentTranslator {
  id = <const>'youdao';
  log: Logger;

  constructor(
    log: Logger,
    private config: YoudaoTranslateConfig,
  ) {
    this.log = log;
  }

  async init() {
    return this;
  }

  segmentor = createBudgetSegmentor(3500);

  async translate(seg: string[], context: SegmentContext): Promise<string[]> {
    const { glossary, signal } = context;
    const log = context.logger ?? this.log;
    return createGlossaryWrapper(glossary)(seg, (seg) =>
      this.translateInner(seg, signal, log),
    );
  }

  async translateInner(
    seg: string[],
    signal: AbortSignal | undefined,
    log: Logger,
  ): Promise<string[]> {
    let from = 'auto';
    const segText = seg.join('\n');
    if (RegexUtil.hasHangulChars(segText)) {
      from = 'ko';
    } else if (RegexUtil.hasKanaChars(segText) || RegexUtil.hasHanzi(segText)) {
      from = 'ja';
    } else if (RegexUtil.hasEnglishChars(segText)) {
      from = 'en';
    }

    try {
      const translations = await YoudaoApi.translate(
        seg.join('\n'),
        from,
        this.config,
        { signal },
      );
      return translations.flatMap((translation) => translation.split(/\r?\n/));
    } catch (error) {
      log(`错误：${error}`);
      throw error;
    }
  }
}

export namespace YoudaoTranslator {
  export type Config = YoudaoTranslateConfig;
  export const create = (log: Logger, config: Config) =>
    new YoudaoTranslator(log, config).init();
}
