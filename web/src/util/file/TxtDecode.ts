import type {
  TxtDecodedDocument,
  TxtDecodeCandidate,
  TxtEncoding,
  TxtSourceLine,
} from '../../model/TxtCatalog';

const ENCODINGS: readonly TxtEncoding[] = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'gb18030',
  'big5',
  'shift_jis',
];

const BYTE_ORDER_MARKS: readonly {
  bytes: readonly number[];
  encoding: TxtEncoding;
}[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

const COMMON_CHINESE = new Set(
  '的一是不了在人有我他这中大来上个国到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意第章节卷部篇集回序终后记尾声番'.split(
    '',
  ),
);

const COMMON_JAPANESE = new Set(
  'のにをはがとでたてしれさあるいるもなからことこのそのためよう私彼女君第章巻話節幕序終後書間'.split(
    '',
  ),
);

const normalizeLineEndings = (text: string) =>
  text
    .replace(/^\uFEFF/, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');

export const normalizeTxtHeadingText = (raw: string) =>
  raw
    .normalize('NFKC')
    .replaceAll(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replaceAll(/[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ' ')
    .trim();

export const buildTxtSourceLines = (text: string): TxtSourceLine[] => {
  const lines = text.split('\n');
  let offset = 0;
  return lines.map((raw, lineIndex) => {
    const line: TxtSourceLine = {
      lineIndex,
      raw,
      normalized: normalizeTxtHeadingText(raw),
      startOffset: offset,
      endOffset: offset + raw.length,
    };
    offset = line.endOffset + (lineIndex < lines.length - 1 ? 1 : 0);
    return line;
  });
};

const countMatches = (text: string, pattern: RegExp) => {
  pattern.lastIndex = 0;
  if (!pattern.global) return pattern.test(text) ? 1 : 0;
  let count = 0;
  while (pattern.exec(text) !== null) count += 1;
  return count;
};

const scoreCommonCharacters = (text: string, encoding: TxtEncoding) => {
  let chinese = 0;
  let japanese = 0;
  for (const character of text) {
    if (COMMON_CHINESE.has(character)) chinese += 1;
    if (COMMON_JAPANESE.has(character)) japanese += 1;
  }
  const length = Math.max(text.length, 1);
  if (encoding === 'shift_jis') return (japanese / length) * 22;
  if (encoding === 'gb18030' || encoding === 'big5')
    return (chinese / length) * 16;
  return (Math.max(chinese, japanese) / length) * 8;
};

const scoreUtf16ByteShape = (bytes: Uint8Array, encoding: TxtEncoding) => {
  if (encoding !== 'utf-16le' && encoding !== 'utf-16be') return 0;
  if (bytes.length < 4 || bytes.length % 2 !== 0) return -18;
  let expectedZeroes = 0;
  let unexpectedZeroes = 0;
  const zeroParity = encoding === 'utf-16le' ? 1 : 0;
  for (let index = 0; index < Math.min(bytes.length, 4096); index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === zeroParity) expectedZeroes += 1;
    else unexpectedZeroes += 1;
  }
  return expectedZeroes * 0.35 - unexpectedZeroes * 1.5;
};

const scoreDecodedText = (
  text: string,
  encoding: TxtEncoding,
  bytes: Uint8Array,
) => {
  const sample = text.slice(0, 200_000);
  const length = Math.max(sample.length, 1);
  const replacementCount = countMatches(sample, /\uFFFD/g);
  const nulCount = countMatches(sample, /\0/g);
  const controlCount = countMatches(
    sample,
    /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
  );
  const privateUseCount = countMatches(sample, /[\uE000-\uF8FF]/g);
  const mojibakeCount = countMatches(
    sample,
    /(?:Ã.|Â.|â[\u0080-\u00BF]|ï»¿|縺.|譁.|蜿.|鬥.|螟.|繧.|ã[\u0080-\u00BF])/g,
  );
  const readableCount = countMatches(sample, /[\p{L}\p{N}\p{P}\p{Zs}\n\t]/gu);
  const kanaCount = countMatches(sample, /[\u3040-\u30FF]/g);
  const hanCount = countMatches(sample, /\p{Script=Han}/gu);

  let score = (readableCount / length) * 100;
  score -= (replacementCount / length) * 2_000;
  score -= (nulCount / length) * 1_000;
  score -= (controlCount / length) * 800;
  score -= (privateUseCount / length) * 300;
  score -= (mojibakeCount / length) * 700;
  score += scoreCommonCharacters(sample, encoding);
  score += scoreUtf16ByteShape(bytes, encoding);

  if (encoding === 'utf-8') score += 8;
  if (encoding === 'shift_jis' && kanaCount > 0) score += 10;
  if (
    (encoding === 'gb18030' || encoding === 'big5') &&
    hanCount > 0 &&
    kanaCount === 0
  ) {
    score += 4;
  }
  return score;
};

const startsWithBytes = (bytes: Uint8Array, prefix: readonly number[]) =>
  prefix.every((byte, index) => bytes[index] === byte);

const decode = (bytes: Uint8Array, encoding: TxtEncoding) => {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return undefined;
  }
};

const detectBom = (bytes: Uint8Array) =>
  BYTE_ORDER_MARKS.find(({ bytes: mark }) => startsWithBytes(bytes, mark));

export const decodeTxtBuffer = (
  source: ArrayBuffer | Uint8Array,
): TxtDecodedDocument => {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const bom = detectBom(bytes);
  const candidates: TxtDecodeCandidate[] = [];
  let best: { encoding: TxtEncoding; score: number; text: string } | undefined;
  for (const encoding of ENCODINGS) {
    if (bom !== undefined && encoding !== bom.encoding) continue;
    const text = decode(bytes, encoding);
    if (text === undefined) continue;
    const bomBonus = bom?.encoding === encoding ? 10_000 : 0;
    const score = scoreDecodedText(text, encoding, bytes) + bomBonus;
    candidates.push({ encoding, score });
    if (best === undefined || score > best.score) {
      best = { encoding, score, text };
    }
  }
  if (best === undefined) {
    throw new Error('无法识别 TXT 文件编码');
  }
  candidates.sort((left, right) => right.score - left.score);
  const text = normalizeLineEndings(best.text);
  return {
    encoding: best.encoding,
    text,
    lines: buildTxtSourceLines(text),
    candidates,
  };
};

export const decodeTxtText = (
  source: string,
  encoding: TxtEncoding = 'utf-8',
): TxtDecodedDocument => {
  const text = normalizeLineEndings(source);
  return {
    encoding,
    text,
    lines: buildTxtSourceLines(text),
    candidates: [{ encoding, score: 100 }],
  };
};
