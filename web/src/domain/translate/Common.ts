import { MD5 } from 'crypto-es';
import { customAlphabet } from 'nanoid';

import { TranslationCacheRepo } from '@/repos';
import type { TranslationCacheEvent } from '@/repos/useTranslationCache';
import type { Glossary } from '@/model/Glossary';
import type { TranslatorId } from '@/model/Translator';

export type TranslationSegment = [
  input: string[],
  previous: string[] | undefined,
  sourceLineIndexes: number[],
];

export type Segmentor = (
  textJp: string[],
  textZh?: string[],
) => TranslationSegment[];

export type Logger = (message: string, detail?: string[]) => void;

export type SegmentContext = {
  glossary: Glossary;
  prevSegs: string[][];
  signal?: AbortSignal;
  logger?: Logger;
  formatRetryCount?: number;
};

export interface SegmentTranslator {
  id: TranslatorId;
  cacheIdentity?: Readonly<Record<string, unknown>>;
  segmentor: Segmentor;
  translate: (seg: string[], context: SegmentContext) => Promise<string[]>;
  log: (message: string, detail?: string[]) => void;
}

export const createGlossaryWrapper = (glossary: Glossary) => {
  const presetTokens = [
    'kie',
    'rgx',
    'wfv',
    'oyg',
    'yhs',
    'rvy',
    'dpt',
    'wkj',
    'gzg',
    'xef',
    'efx',
    'ugx',
    'woz',
    'peh',
    'rjp',
    'eon',
    'ayj',
    'gkp',
    'wie',
    'yla',
  ];
  const usedToken: string[] = [];
  const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 4);
  const generateToken = () => {
    let token = presetTokens.shift();
    if (token === undefined) {
      while (true) {
        token = nanoid();
        if (
          !/(.)\1/.test(token) &&
          !usedToken.some((used) => token!.includes(used))
        ) {
          break;
        }
      }
    }
    usedToken.push(token);
    return token;
  };

  const sortedKeys = (glossary: Glossary) =>
    Object.keys(glossary).sort((a, b) => b.length - a.length);

  const wordJpToToken: Glossary = {};
  const tokenToWordZh: Glossary = {};
  for (const wordJp of sortedKeys(glossary)) {
    const wordZh = glossary[wordJp];
    const token = generateToken();
    wordJpToToken[wordJp] = token;
    tokenToWordZh[token] = wordZh;
  }

  const encode = (text: string[]): string[] => {
    return text.map((line) => {
      for (const wordJp of sortedKeys(wordJpToToken)) {
        const token = wordJpToToken[wordJp];
        line = line.replaceAll(wordJp, '$' + token);
      }
      return line;
    });
  };

  const decode = (text: string[]): string[] => {
    return text.map((line) => {
      for (const token of sortedKeys(tokenToWordZh)) {
        const wordZh = tokenToWordZh[token];
        line = line
          .replaceAll('$' + token, wordZh)
          .replaceAll('$ ' + token, wordZh)
          .replaceAll(token, wordZh);
      }
      return line;
    });
  };

  return async (
    textJp: string[],
    callback: (input: string[]) => Promise<string[]>,
  ) => {
    const textJpEncoded = encode(textJp);
    const textZh = await callback(textJpEncoded);
    const textZhDecoded = decode(textZh);
    return textZhDecoded;
  };
};

export const estimateTranslationSize = (text: string) => {
  let size = 0;
  for (const character of text) {
    if (/\s/u.test(character)) size += 0.25;
    else if (/^[\x00-\x7f]$/u.test(character)) size += 0.5;
    else if (
      /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)
    ) {
      size += 1;
    } else size += 1;
  }
  return size;
};

const splitLineByBudget = (line: string, budget: number) => {
  if (line.length === 0) return [''];
  const characters = Array.from(line);
  const parts: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let size = 0;
    let end = start;
    let naturalEnd = -1;
    while (end < characters.length) {
      const nextSize = estimateTranslationSize(characters[end]);
      if (end > start && size + nextSize > budget) break;
      size += nextSize;
      end += 1;
      if (
        size >= budget * 0.6 &&
        /[。！？.!?；;、，,：:\s]/u.test(characters[end - 1])
      ) {
        naturalEnd = end;
      }
    }
    const splitAt =
      end < characters.length && naturalEnd > start ? naturalEnd : end;
    parts.push(characters.slice(start, splitAt).join(''));
    start = splitAt;
  }
  return parts;
};

export const createBudgetSegmentor = (
  maxSize: number,
  maxLine?: number,
  lineOverhead = 0,
): Segmentor => {
  const lineLimit =
    maxLine === undefined || !Number.isFinite(maxLine)
      ? 65_536
      : Math.max(1, Math.floor(maxLine));
  const budget = Number.isFinite(maxSize) ? Math.max(1, maxSize) : 1;
  const normalizedLineOverhead = Number.isFinite(lineOverhead)
    ? Math.min(Math.max(0, lineOverhead), Math.max(0, budget - 1))
    : 0;
  const contentBudget = Math.max(1, budget - normalizedLineOverhead);

  return (textJp: string[], textZh?: string[]) => {
    const segs: TranslationSegment[] = [];
    let segJp: string[] = [];
    let segZh: string[] = [];
    let sourceLineIndexes: number[] = [];
    let segSize = 0;

    const flush = () => {
      if (segJp.length === 0) return;
      segs.push([
        segJp,
        textZh === undefined ? undefined : segZh,
        sourceLineIndexes,
      ]);
      segJp = [];
      segZh = [];
      sourceLineIndexes = [];
      segSize = 0;
    };

    for (let i = 0; i < textJp.length; i++) {
      const lineParts = splitLineByBudget(textJp[i], contentBudget);
      for (let partIndex = 0; partIndex < lineParts.length; partIndex++) {
        const lineJp = lineParts[partIndex];
        const lineSize =
          estimateTranslationSize(lineJp) + normalizedLineOverhead;
        if (segSize + lineSize > budget || segJp.length >= lineLimit) flush();

        segJp.push(lineJp);
        sourceLineIndexes.push(i);
        segSize += lineSize;
        if (textZh !== undefined) {
          segZh.push(partIndex === 0 ? textZh[i] : '');
        }
      }
    }
    flush();
    return segs;
  };
};

export interface SegmentCache {
  cacheKey(seg: string[], extra?: unknown): string;
  get(cacheKey: string): Promise<string[] | undefined>;
  save(cacheKey: string, output: string[]): Promise<void>;
  getOrCreate?: (
    cacheKey: string,
    producer: () => Promise<string[]>,
    validate: (output: string[]) => boolean,
  ) => Promise<{
    output: string[];
    source: 'cache' | 'deduplicated' | 'provider';
    cacheFault: boolean;
  }>;
  record?: (event: TranslationCacheEvent) => void;
}

const cacheInFlight = {
  'gpt-seg-cache': new Map<
    string,
    { generation: number; promise: Promise<string[]> }
  >(),
  'sakura-seg-cache': new Map<
    string,
    { generation: number; promise: Promise<string[]> }
  >(),
};

export const createSegIndexedDbCache = async (
  storeName: 'gpt-seg-cache' | 'sakura-seg-cache',
) => {
  const get = (hash: string): Promise<string[] | undefined> =>
    TranslationCacheRepo.get(storeName, hash);
  const save = (hash: string, text: string[]): Promise<void> =>
    TranslationCacheRepo.create(storeName, hash, text).then(() => {});
  return <SegmentCache>{
    cacheKey: (seg: string[], extra?: unknown): string =>
      MD5(JSON.stringify({ seg, extra })).toString(),

    get,
    save,
    record: (event) => TranslationCacheRepo.record(storeName, event),
    getOrCreate: async (hash, producer, validate) => {
      const generation = TranslationCacheRepo.generation(storeName);
      let cacheFault = false;
      const cached = await get(hash).catch(() => {
        TranslationCacheRepo.record(storeName, 'fault');
        cacheFault = true;
        return undefined;
      });
      if (cached !== undefined) {
        if (validate(cached)) {
          TranslationCacheRepo.record(storeName, 'hit');
          return { output: cached, source: 'cache', cacheFault };
        }
        TranslationCacheRepo.record(storeName, 'fault');
        cacheFault = true;
      }
      TranslationCacheRepo.record(storeName, 'miss');

      const active = cacheInFlight[storeName].get(hash);
      if (active?.generation === generation) {
        TranslationCacheRepo.record(storeName, 'deduplicated');
        return {
          output: await active.promise,
          source: 'deduplicated',
          cacheFault,
        };
      }

      TranslationCacheRepo.record(storeName, 'provider');
      const pending = producer();
      const inFlight = { generation, promise: pending };
      cacheInFlight[storeName].set(hash, inFlight);
      try {
        const output = await pending;
        if (TranslationCacheRepo.generation(storeName) === generation) {
          await save(hash, output).catch(() => {
            TranslationCacheRepo.record(storeName, 'fault');
            cacheFault = true;
          });
        }
        return { output, source: 'provider', cacheFault };
      } finally {
        if (cacheInFlight[storeName].get(hash) === inFlight) {
          cacheInFlight[storeName].delete(hash);
        }
      }
    },
  };
};
