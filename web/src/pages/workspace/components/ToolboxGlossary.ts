export interface GlossaryCandidate {
  word: string;
  count: number;
}

export type GlossarySort =
  'count-desc' | 'count-asc' | 'word-asc' | 'word-desc';

export interface GlossaryFilterOptions {
  minimumCount: number;
  query?: string;
  sort?: GlossarySort;
  excluded?: ReadonlySet<string>;
}

export const countKatakanaTerms = (content: string) => {
  const counts = new Map<string, number>();
  const normalized = content.normalize('NFKC');
  for (const match of normalized.matchAll(/[\p{Script=Katakana}ー]{2,}/gu)) {
    const word = match[0];
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
};

export const mergeGlossaryCounts = (
  sources: Iterable<ReadonlyMap<string, number>>,
) => {
  const merged = new Map<string, number>();
  for (const source of sources) {
    for (const [word, count] of source) {
      merged.set(word, (merged.get(word) ?? 0) + count);
    }
  }
  return merged;
};

export const filterGlossaryCandidates = (
  counts: ReadonlyMap<string, number>,
  options: GlossaryFilterOptions,
): GlossaryCandidate[] => {
  const query = options.query?.trim().normalize('NFKC') ?? '';
  const candidates = [...counts]
    .filter(
      ([word, count]) =>
        count >= options.minimumCount &&
        !options.excluded?.has(word) &&
        (query.length === 0 || word.includes(query)),
    )
    .map(([word, count]) => ({ word, count }));
  const sort = options.sort ?? 'count-desc';
  candidates.sort((left, right) => {
    switch (sort) {
      case 'count-asc':
        return left.count - right.count || left.word.localeCompare(right.word);
      case 'word-asc':
        return left.word.localeCompare(right.word);
      case 'word-desc':
        return right.word.localeCompare(left.word);
      default:
        return right.count - left.count || left.word.localeCompare(right.word);
    }
  });
  return candidates;
};

export interface GlossaryTranslationProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentWord: string;
}

export interface GlossaryTranslationResult {
  translations: Map<string, string>;
  failures: Map<string, unknown>;
}

export interface GlossaryTranslationOptions {
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: GlossaryTranslationProgress) => void;
}

export const mergeAutomaticTranslations = (
  current: Readonly<Record<string, string>>,
  incoming: ReadonlyMap<string, string>,
  manuallyEdited: ReadonlySet<string>,
) => {
  const merged = { ...current };
  incoming.forEach((value, word) => {
    if (!manuallyEdited.has(word)) merged[word] = value;
  });
  return merged;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('翻译已取消', 'AbortError');
  }
};

const validateTranslations = (words: string[], translated: string[]) => {
  if (translated.length !== words.length) {
    throw new Error(
      `翻译行数不一致：请求 ${words.length}，返回 ${translated.length}`,
    );
  }
  if (translated.some((value) => value.trim().length === 0)) {
    throw new Error('翻译结果包含空译文');
  }
  return translated;
};

export const translateGlossaryWords = async (
  words: string[],
  translate: (words: string[], signal?: AbortSignal) => Promise<string[]>,
  options: GlossaryTranslationOptions = {},
): Promise<GlossaryTranslationResult> => {
  const translations = new Map<string, string>();
  const failures = new Map<string, unknown>();
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 20));
  let completed = 0;

  const report = (currentWord: string) =>
    options.onProgress?.({
      total: words.length,
      completed,
      succeeded: translations.size,
      failed: failures.size,
      currentWord,
    });

  for (let offset = 0; offset < words.length; offset += batchSize) {
    throwIfAborted(options.signal);
    const batch = words.slice(offset, offset + batchSize);
    try {
      const translated = validateTranslations(
        batch,
        await translate(batch, options.signal),
      );
      throwIfAborted(options.signal);
      batch.forEach((word, index) => {
        translations.set(word, translated[index] ?? '');
      });
      completed += batch.length;
      report(batch.at(-1) ?? '');
    } catch (batchError) {
      throwIfAborted(options.signal);
      for (const word of batch) {
        throwIfAborted(options.signal);
        try {
          const translated = validateTranslations(
            [word],
            await translate([word], options.signal),
          );
          throwIfAborted(options.signal);
          translations.set(word, translated[0] ?? '');
        } catch (error) {
          throwIfAborted(options.signal);
          failures.set(word, error ?? batchError);
        }
        completed += 1;
        report(word);
      }
    }
  }

  return { translations, failures };
};
