export type ReaderChineseScript = 'none' | 'simplified' | 'traditional';

type Converter = (text: string) => string;

const defaultMaximumEntries = 2_000;

const loadConverters = async () => {
  const { default: OpenCC } = await import('opencc-js');
  return {
    simplified: OpenCC.Converter({ from: 't', to: 'cn' }),
    traditional: OpenCC.Converter({ from: 'cn', to: 't' }),
  } satisfies Record<Exclude<ReaderChineseScript, 'none'>, Converter>;
};

export const createReaderChineseScriptService = (options?: {
  maximumEntries?: number;
  load?: typeof loadConverters;
}) => {
  const maximumEntries = Math.max(
    0,
    Math.floor(options?.maximumEntries ?? defaultMaximumEntries),
  );
  const cache = new Map<string, string>();
  let converters:
    Promise<Awaited<ReturnType<typeof loadConverters>>> | undefined;

  const convert = async ({
    bookId,
    script,
    text,
  }: {
    bookId: string;
    script: ReaderChineseScript;
    text: string;
  }) => {
    if (script === 'none' || text.length === 0) return text;
    const key = `${bookId}\u0000${script}\u0000${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    converters ??= (options?.load ?? loadConverters)();
    const converted = (await converters)[script](text);
    if (maximumEntries > 0) {
      cache.set(key, converted);
      while (cache.size > maximumEntries) {
        cache.delete(cache.keys().next().value!);
      }
    }
    return converted;
  };

  const releaseBook = (bookId: string) => {
    const prefix = `${bookId}\u0000`;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  };

  const clear = () => cache.clear();

  return { convert, releaseBook, clear };
};

export const readerChineseScriptService = createReaderChineseScriptService();
