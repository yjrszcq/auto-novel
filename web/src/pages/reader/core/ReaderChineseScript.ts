import type { ReaderChineseScript } from '@/model/Reader';
import type { ReaderSegment } from '@/model/Reader';

export type { ReaderChineseScript } from '@/model/Reader';

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

  const getConverters = () => {
    if (converters === undefined) {
      converters = (options?.load ?? loadConverters)();
      converters.catch(() => {
        converters = undefined;
      });
    }
    return converters;
  };

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
    const converted = (await getConverters())[script](text);
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

export const getReaderChineseScriptSides = (
  requiresWholeChapterTranslation: boolean,
) => ({
  original: !requiresWholeChapterTranslation,
  translated: requiresWholeChapterTranslation,
});

export const convertReaderSegments = async ({
  bookId,
  script,
  segments,
  original,
  translated,
}: {
  bookId: string;
  script: ReaderChineseScript;
  segments: ReaderSegment[];
  original: boolean;
  translated: boolean;
}) =>
  Promise.all(
    segments.map(async (segment) => ({
      ...segment,
      original: original
        ? await readerChineseScriptService.convert({
            bookId,
            script,
            text: segment.original,
          })
        : segment.original,
      translated:
        translated && segment.translated !== undefined
          ? await readerChineseScriptService.convert({
              bookId,
              script,
              text: segment.translated,
            })
          : segment.translated,
    })),
  );

export const convertReaderTextParts = async ({
  bookId,
  script,
  parts,
}: {
  bookId: string;
  script: ReaderChineseScript;
  parts: string[];
}) => {
  const source = parts.join('');
  const converted = await readerChineseScriptService.convert({
    bookId,
    script,
    text: source,
  });
  const convertedCharacters = Array.from(converted);
  const sourceLengths = parts.map((part) => Array.from(part).length);
  if (
    convertedCharacters.length ===
    sourceLengths.reduce((sum, length) => sum + length, 0)
  ) {
    let offset = 0;
    return sourceLengths.map((length) => {
      const part = convertedCharacters.slice(offset, offset + length).join('');
      offset += length;
      return part;
    });
  }
  return Promise.all(
    parts.map((text) =>
      readerChineseScriptService.convert({ bookId, script, text }),
    ),
  );
};
